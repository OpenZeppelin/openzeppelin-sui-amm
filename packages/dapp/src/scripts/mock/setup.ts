/**
 * Localnet bootstrap: publishes mock Move packages (coins/Pyth) and seeds objects.
 * Publishes packages, records artifacts, and reuses them to keep runs idempotent.
 */

import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  ALL_MOCK_PRICE_FEEDS,
  deriveMockPriceComponents,
  getPythPriceInfoType,
  isMatchingMockPriceFeedConfig,
  publishMockPriceFeed,
  type LabeledMockPriceFeedConfig
} from "@sui-amm/domain-core/models/pyth"
import {
  buildCoinTransferTransaction,
  fetchCoinBalances,
  selectRichestCoin,
  type SuiCoinBalance
} from "@sui-amm/tooling-core/coin"
import { deriveCurrencyObjectId } from "@sui-amm/tooling-core/coin-registry"
import { assertLocalnetNetwork } from "@sui-amm/tooling-core/network"
import { objectTypeMatches } from "@sui-amm/tooling-core/object"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import {
  getLatestDeploymentFromArtifact,
  readArtifact
} from "@sui-amm/tooling-node/artifacts"
import { AMM_PACKAGE_NAME } from "@sui-amm/domain-node/amm"
import {
  DEFAULT_TX_GAS_BUDGET,
  SUI_CLOCK_ID,
  SUI_COIN_REGISTRY_ID
} from "@sui-amm/tooling-node/constants"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logWarning
} from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { waitForObjectState } from "@sui-amm/tooling-node/testing/objects"
import {
  ensureCreatedObject,
  findCreatedObjectIds,
  newTransaction
} from "@sui-amm/tooling-node/transactions"
import type {
  CoinArtifact,
  MockArtifact,
  PriceFeedArtifact
} from "../../utils/mocks.ts"
import {
  DEFAULT_COIN_CONTRACT_PATH,
  mockArtifactPath,
  writeMockArtifact
} from "../../utils/mocks.ts"

process.env.SUI_NETWORK = "localnet"

type SetupLocalCliArgs = {
  traderAddress?: string
  coinPackageId?: string
  coinContractPath: string
  rePublish?: boolean
  useCliPublish?: boolean
}

type ExistingMockState = Pick<
  MockArtifact,
  "coinPackageId" | "coins" | "priceFeeds" | "pythStateId"
>

type SeededCoin = {
  coin: CoinArtifact
  wasCreated: boolean
}

type CoinSeed = Pick<CoinArtifact, "label" | "coinType"> & {
  initTarget: string
}

// Localnet seeds: one PriceInfoObject per real Pyth feed identifier so the
// `@pythnetwork/pyth-sui-js` SDK's `getPriceFeedObjectId(feedId)` resolves
// `SUI/USD` and `USDC/USD` against our mock State exactly as it does on
// mainnet/testnet against the real Pyth State.
const DEFAULT_FEEDS: LabeledMockPriceFeedConfig[] = ALL_MOCK_PRICE_FEEDS
const PACKAGE_AVAILABILITY_TIMEOUT_MS = 20_000
const PACKAGE_AVAILABILITY_INTERVAL_MS = 250

const normalizeSetupInputs = (
  cliArguments: SetupLocalCliArgs
): SetupLocalCliArgs => ({
  ...cliArguments,
  traderAddress: cliArguments.traderAddress
    ? normalizeSuiAddress(cliArguments.traderAddress)
    : undefined
})

// Parse CLI flags and reuse prior mock artifacts unless --re-publish is set.
// deepbook/pyth ids and shared objects always come from the latest AMM publish
// (resolved in publishLocalnetPackages), so they're not part of the reusable
// existing-state cache.
const extendCliArguments = async (
  baseScriptArguments: SetupLocalCliArgs
): Promise<ExistingMockState> => {
  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})

  return {
    coinPackageId: baseScriptArguments.rePublish
      ? undefined
      : baseScriptArguments.coinPackageId || mockArtifact.coinPackageId,
    // priceFeeds and pythStateId are always carried over from the previous
    // run (regardless of --re-publish). The runner cross-checks them against
    // the freshly-discovered pythStateId and only re-publishes feeds when the
    // State id has actually changed (i.e., the AMM was re-published).
    // Otherwise re-publishing the same feed_id into a live State aborts with
    // a dynamic-field key collision.
    priceFeeds: mockArtifact.priceFeeds,
    pythStateId: mockArtifact.pythStateId,
    coins: baseScriptArguments.rePublish ? undefined : mockArtifact.coins
  }
}

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = normalizeSetupInputs(cliArguments)
    const {
      suiConfig: { network }
    } = tooling
    // Guard: mock seeding must be localnet-only to avoid leaking dev packages to shared networks.
    assertLocalnetNetwork(network.networkName)

    // Load prior artifacts unless --re-publish was passed (idempotent runs).
    const existingState = await extendCliArguments(inputs)

    // Load signer (env/keystore) and derive address; Sui requires explicit key material for PTBs.
    // Ensure the account has gas coins (auto-faucet on localnet) to avoid funding errors downstream.
    await tooling.ensureFoundedAddress({
      signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
      signer: tooling.loadedEd25519KeyPair
    })

    // Publish or reuse mock Pyth + mock coin packages; record package IDs for later steps.
    const {
      coinPackageId,
      pythPackageId,
      pythStateId,
      deepbookPackageId,
      deepbookRegistryId,
      deepbookAdminCapId,
      deepbookTokenPackageId
    } = await publishLocalnetPackages(
      {
        existingState,
        cliArguments: inputs
      },
      tooling
    )

    // Fetch shared Coin Registry and Clock objects; required for minting coins and timestamp price feeds.
    const { coinRegistryObject, clockObject } =
      await resolveRegistryAndClockRefs(tooling)

    // Ensure mock coins exist (mint + register in coin registry if missing); reuse if already minted.
    const seededCoins = await ensureMockCoins(
      {
        coinPackageId,
        owner: tooling.loadedEd25519KeyPair.toSuiAddress(),
        signer: tooling.loadedEd25519KeyPair,
        coinRegistryObject
      },
      tooling
    )

    const coins = seededCoins.map((seeded) => seeded.coin)

    // Persist coin artifacts for reuse in later runs/scripts.
    await writeMockArtifact(mockArtifactPath, {
      coins
    })

    const createdCoins = seededCoins
      .filter((seeded) => seeded.wasCreated)
      .map((seeded) => seeded.coin)

    if (inputs.traderAddress)
      await transferQuarterTreasuryToTrader(
        {
          coins: createdCoins,
          traderAddress: inputs.traderAddress,
          signer: tooling.loadedEd25519KeyPair,
          signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress()
        },
        tooling
      )
    else logWarning("--trader-address not supplied skipping fund transfer")

    // Cached feeds belong to a specific State id. If the AMM was re-published
    // since the last mock:setup, the State id rotated and any cached
    // PriceInfoObjects point at a dead State — drop them so ensurePriceFeeds
    // creates fresh ones in the new State.
    const cachedFeedsAreLive = existingState.pythStateId === pythStateId
    const desiredExistingPriceFeeds = cachedFeedsAreLive
      ? filterPriceFeedsToDefaults(existingState.priceFeeds || [])
      : []
    const priceFeeds = await ensurePriceFeeds(
      {
        pythPackageId,
        pythStateId,
        signer: tooling.loadedEd25519KeyPair,
        clockObject,
        existingPriceFeeds: desiredExistingPriceFeeds
      },
      tooling
    )

    // Keep all mock feeds aligned with the configured values (even when reusing existing objects).
    await refreshPriceFeeds(
      {
        pythPackageId,
        signer: tooling.loadedEd25519KeyPair,
        clockObject,
        priceFeeds
      },
      tooling
    )

    // Persist price feed artifacts for reuse.
    await writeMockArtifact(mockArtifactPath, {
      priceFeeds
    })

    logKeyValueGreen("Pyth package")(pythPackageId)
    logKeyValueGreen("Coin package")(coinPackageId)
    if (deepbookPackageId) {
      logKeyValueGreen("DeepBook package")(deepbookPackageId)
      logKeyValueGreen("DeepBook registry")(deepbookRegistryId ?? "unknown")
      logKeyValueGreen("DeepBook admin-cap")(deepbookAdminCapId ?? "unknown")
    }
    if (deepbookTokenPackageId)
      logKeyValueGreen("DeepBook token")(deepbookTokenPackageId)
    logKeyValueGreen("Feeds")(JSON.stringify(priceFeeds))
    logKeyValueGreen("Coins")(JSON.stringify(coins))
  },
  yargs()
    .option("traderAddress", {
      alias: ["trader-address", "trader"],
      type: "string",
      description: "Trader address to receive quarter of each minted mock coin"
    })
    .option("coinPackageId", {
      alias: "coin-package-id",
      type: "string",
      description:
        "Package ID of the Coin Move package on the local localNetwork"
    })
    .option("coinContractPath", {
      alias: "coin-contract-path",
      type: "string",
      description: "Path to the local coin stub Move package to publish",
      default: DEFAULT_COIN_CONTRACT_PATH
    })
    .option("rePublish", {
      alias: "re-publish",
      type: "boolean",
      description: "Re-create and overwrite local mock data",
      default: false
    })
    .option("useCliPublish", {
      alias: "use-cli-publish",
      type: "boolean",
      description:
        "Publish mock packages with the Sui CLI instead of the SDK (use --no-use-cli-publish to force SDK).",
      default: true
    })
    .strict()
)

const publishLocalnetPackages = async (
  {
    cliArguments,
    existingState
  }: {
    cliArguments: SetupLocalCliArgs
    existingState: ExistingMockState
  },
  tooling: Tooling
) => {
  // The AMM publish (run separately via `pnpm --filter dapp move:publish
  // --package-path prop-amm`) is expected to have run first. With
  // `--with-unpublished-dependencies` it inlines deepbook + token + pyth-mock
  // bytecode into the AMM's package address, and those deps' `init` functions
  // run during the same publish — auto-sharing the DeepBook `Registry` /
  // `DeepbookAdminCap` and the Pyth `State`. We discover them here rather
  // than republishing standalone copies that would type-mismatch the AMM.
  const ammArtifact =
    await getLatestDeploymentFromArtifact(AMM_PACKAGE_NAME)("localnet")
  if (!ammArtifact) {
    throw new Error(
      "AMM not yet published. Run `pnpm --filter dapp move:publish --package-path prop-amm --re-publish` before `mock:setup`."
    )
  }
  const mergedPackageId = normalizeSuiObjectId(ammArtifact.packageId)
  const ammPublishDigest = ammArtifact.digest
  if (!ammPublishDigest)
    throw new Error(
      "Latest AMM deployment artifact has no `digest`; cannot recover deepbook/pyth shared objects from the publish txn."
    )

  // The merged AMM provides deepbook, token, and pyth modules at its own id,
  // so the three "package id" slots all collapse to the AMM id.
  const deepbookPackageId = mergedPackageId
  const deepbookTokenPackageId = mergedPackageId
  const pythPackageId = mergedPackageId

  // Always re-discover from the latest AMM publish: a fresh `move:publish`
  // produces new shared-object ids even if the user didn't pass --re-publish
  // to mock:setup, and stale ids would silently route writes into ghost
  // objects.
  const { deepbookRegistryId, deepbookAdminCapId } =
    await resolveDeepbookObjectsFromPublish(ammPublishDigest, tooling.suiClient)
  const pythStateId = await resolvePythStateFromPublish(
    ammPublishDigest,
    tooling.suiClient
  )

  // coin-mock is the only mock that isn't a dep of the AMM, so it stays a
  // standalone package (idempotent: re-uses the cached id when present).
  let coinPackageId = existingState.coinPackageId
  if (!coinPackageId) {
    const coinPublish = await tooling.publishMovePackageWithFunding({
      packagePath: cliArguments.coinContractPath,
      clearPublishedEntry: true,
      useCliPublish: cliArguments.useCliPublish
    })
    coinPackageId = coinPublish.packageId
    await waitForPackageAvailability(
      coinPackageId,
      tooling.suiClient,
      "coin-mock"
    )
  }

  await writeMockArtifact(mockArtifactPath, {
    coinPackageId,
    deepbookPackageId,
    deepbookTokenPackageId,
    deepbookRegistryId,
    deepbookAdminCapId,
    pythPackageId,
    pythStateId
  })

  return {
    pythPackageId,
    pythStateId,
    coinPackageId,
    deepbookPackageId,
    deepbookRegistryId,
    deepbookAdminCapId,
    deepbookTokenPackageId
  }
}

const waitForPackageAvailability = async (
  packageId: string,
  suiClient: SuiClient,
  label: string
) => {
  await waitForObjectState({
    suiClient,
    objectId: packageId,
    label: `${label} package`,
    timeoutMs: PACKAGE_AVAILABILITY_TIMEOUT_MS,
    intervalMs: PACKAGE_AVAILABILITY_INTERVAL_MS,
    objectOptions: { showType: true, showContent: true },
    predicate: (response) => response.data?.content?.dataType === "package"
  })
}

const resolvePythStateFromPublish = async (
  publishDigest: string,
  suiClient: SuiClient
): Promise<string> => {
  const publishTransaction = await suiClient.getTransactionBlock({
    digest: publishDigest,
    options: { showObjectChanges: true }
  })

  return ensureCreatedObject("::pyth_state::State", publishTransaction).objectId
}

const resolveDeepbookObjectsFromPublish = async (
  publishDigest: string,
  suiClient: SuiClient
) => {
  const publishTransaction = await suiClient.getTransactionBlock({
    digest: publishDigest,
    options: { showObjectChanges: true }
  })

  const deepbookRegistryId = ensureCreatedObject(
    "::registry::Registry",
    publishTransaction
  ).objectId
  const deepbookAdminCapId = ensureCreatedObject(
    "::registry::DeepbookAdminCap",
    publishTransaction
  ).objectId

  return {
    deepbookRegistryId,
    deepbookAdminCapId
  }
}

const resolveRegistryAndClockRefs = async (
  tooling: Pick<Tooling, "getMutableSharedObject" | "getImmutableSharedObject">
) => {
  // Coin registry is a shared object; clock is used to timestamp price feeds for freshness checks.
  const [coinRegistryObject, clockObject] = await Promise.all([
    tooling.getMutableSharedObject({ objectId: SUI_COIN_REGISTRY_ID }),
    tooling.getImmutableSharedObject({ objectId: SUI_CLOCK_ID })
  ])
  return { coinRegistryObject, clockObject }
}

const ensureMockCoins = async (
  {
    coinPackageId,
    owner,
    signer,
    coinRegistryObject
  }: {
    coinPackageId: string
    owner: string
    signer: Ed25519Keypair
    coinRegistryObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<SeededCoin[]> => {
  const seededCoins: SeededCoin[] = []
  for (const seed of buildCoinSeeds(coinPackageId)) {
    // Serialize shared-coin-registry writes to avoid localnet contention.
    seededCoins.push(
      await ensureCoin(
        {
          seed,
          owner,
          signer,
          coinRegistryObject
        },
        tooling
      )
    )
  }

  return seededCoins
}

const ensureCoin = async (
  {
    seed,
    owner,
    signer,
    coinRegistryObject
  }: {
    seed: CoinSeed
    owner: string
    signer: Ed25519Keypair
    coinRegistryObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<SeededCoin> => {
  const derivedCurrencyObjectId = deriveCurrencyObjectId(
    seed.coinType,
    SUI_COIN_REGISTRY_ID
  )

  // Read any existing coin metadata/currency object and any minted coin for the owner.
  const [metadata, resolvedCurrencyObjectId, ownedCoins] = await Promise.all([
    tooling.suiClient.getCoinMetadata({ coinType: seed.coinType }),
    tooling
      .resolveCurrencyObjectId({
        coinType: seed.coinType,
        registryId: SUI_COIN_REGISTRY_ID
      })
      .catch(() => undefined),
    fetchCoinBalances(
      { owner, coinType: seed.coinType },
      { suiClient: tooling.suiClient }
    ).catch(() => [])
  ])
  const mintedCoinObjectId = ownedCoins[0]?.coinObjectId
  const currencyObjectId = resolvedCurrencyObjectId ?? derivedCurrencyObjectId

  if (metadata || resolvedCurrencyObjectId) {
    // Already initialized; return discovered artifacts (may be partial).
    if (!resolvedCurrencyObjectId) {
      logWarning(
        `Currency object for ${seed.label} not readable; using derived ID ${currencyObjectId}.`
      )
    } else {
      logKeyValueBlue("Coin")(`${seed.label} ${seed.coinType}`)
    }
    return {
      coin: {
        label: seed.label,
        coinType: seed.coinType,
        currencyObjectId,
        mintedCoinObjectId
      },
      wasCreated: false
    }
  }

  // Not found: initialize the mock coin via coin registry and fund the owner.
  const initTransaction = newTransaction(DEFAULT_TX_GAS_BUDGET)

  initTransaction.moveCall({
    target: seed.initTarget,
    arguments: [
      initTransaction.sharedObjectRef(coinRegistryObject.sharedRef),
      initTransaction.pure.address(owner)
    ]
  })

  const { transactionResult } = await tooling.withTestnetFaucetRetry(
    {
      signerAddress: signer.toSuiAddress(),
      signer
    },
    async () =>
      await tooling.signAndExecute({
        transaction: initTransaction,
        signer
      })
  )

  // Parse created objects from the transaction (currency, treasury cap, metadata, minted coin).
  const created = coinArtifactsFromResult({
    transactionResult,
    seed,
    derivedCurrencyId: currencyObjectId
  })

  logKeyValueGreen("Coin")(`${seed.label} ${created.currencyObjectId}`)

  return {
    coin: {
      ...created,
      mintedCoinObjectId: created.mintedCoinObjectId ?? mintedCoinObjectId
    },
    wasCreated: true
  }
}

const transferQuarterTreasuryToTrader = async (
  {
    coins,
    traderAddress,
    signer,
    signerAddress
  }: {
    coins: CoinArtifact[]
    traderAddress: string
    signer: Ed25519Keypair
    signerAddress: string
  },
  tooling: Tooling
) => {
  if (coins.length === 0) return

  for (const coin of coins) {
    await transferQuarterTreasuryForCoin(
      {
        coin,
        traderAddress,
        signer,
        signerAddress
      },
      tooling
    )
  }
}

const transferQuarterTreasuryForCoin = async (
  {
    coin,
    traderAddress,
    signer,
    signerAddress
  }: {
    coin: CoinArtifact
    traderAddress: string
    signer: Ed25519Keypair
    signerAddress: string
  },
  tooling: Tooling
) => {
  const treasurySnapshot = await resolveTreasuryCoinSnapshot({
    coinType: coin.coinType,
    owner: signerAddress,
    mintedCoinObjectId: coin.mintedCoinObjectId,
    suiClient: tooling.suiClient
  })

  if (!treasurySnapshot) {
    logWarning(
      `No coin objects found for ${coin.label} (${coin.coinType}); skipping trader transfer.`
    )
    return
  }

  const transferAmount = calculateQuarterBalance(treasurySnapshot.balance)
  if (transferAmount <= 0n) {
    logWarning(
      `Balance too small to split for ${coin.label} (${coin.coinType}); skipping trader transfer.`
    )
    return
  }

  const coinSnapshot = await tooling.resolveCoinOwnership({
    coinObjectId: treasurySnapshot.coinObjectId
  })

  ensureSignerOwnsCoin({
    coinObjectId: treasurySnapshot.coinObjectId,
    coinOwnerAddress: coinSnapshot.ownerAddress,
    signerAddress
  })

  const transferTransaction = buildCoinTransferTransaction({
    coinObjectId: treasurySnapshot.coinObjectId,
    amount: transferAmount,
    recipientAddress: traderAddress
  })

  const { transactionResult } = await tooling.signAndExecute({
    transaction: transferTransaction,
    signer
  })

  logKeyValueGreen("Trader transfer")(`${coin.label} ${coin.coinType}`)
  logKeyValueGreen("amount")(transferAmount.toString())
  logKeyValueGreen("from")(signerAddress)
  logKeyValueGreen("to")(traderAddress)
  if (transactionResult.digest)
    logKeyValueGreen("digest")(transactionResult.digest)
}

const coinArtifactsFromResult = ({
  transactionResult,
  seed,
  derivedCurrencyId
}: {
  transactionResult: SuiTransactionBlockResponse
  seed: CoinSeed
  derivedCurrencyId: string
}): CoinArtifact => {
  const coinTypeSuffix = `<${seed.coinType}>`
  const currencyObjectId =
    findCreatedObjectIds(
      transactionResult,
      `::coin_registry::Currency${coinTypeSuffix}`
    )[0] ?? derivedCurrencyId

  return {
    label: seed.label,
    coinType: seed.coinType,
    currencyObjectId,
    treasuryCapId:
      findCreatedObjectIds(
        transactionResult,
        `::coin::TreasuryCap${coinTypeSuffix}`
      )[0] ?? undefined,
    metadataObjectId:
      findCreatedObjectIds(
        transactionResult,
        `::coin::CoinMetadata${coinTypeSuffix}`
      )[0] ?? undefined,
    mintedCoinObjectId:
      findCreatedObjectIds(
        transactionResult,
        `::coin::Coin${coinTypeSuffix}`
      )[0] ?? undefined
  }
}

const ensurePriceFeeds = async (
  {
    pythPackageId,
    pythStateId,
    signer,
    existingPriceFeeds,
    clockObject
  }: {
    pythPackageId: string
    pythStateId: string
    signer: Ed25519Keypair
    existingPriceFeeds: PriceFeedArtifact[]
    clockObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<PriceFeedArtifact[]> => {
  const priceInfoType = getPythPriceInfoType(pythPackageId)
  // Pyth State holds the `Table<PriceIdentifier, ID>` registry; publishing a
  // feed mutates it, so we need a mutable shared ref.
  const pythStateObject = await tooling.getMutableSharedObject({
    objectId: pythStateId
  })
  const feeds: PriceFeedArtifact[] = []

  for (const feedConfig of DEFAULT_FEEDS) {
    // If a matching feed exists and the object type matches, reuse it.
    const matchingExisting = findMatchingFeed(existingPriceFeeds, feedConfig)
    const existingObject = matchingExisting
      ? await tooling.getObjectSafe({
          objectId: matchingExisting.priceInfoObjectId
        })
      : undefined

    if (matchingExisting && objectTypeMatches(existingObject, priceInfoType)) {
      feeds.push(matchingExisting)
      continue
    }

    if (matchingExisting) {
      logWarning(
        `Feed ${feedConfig.label} not found or mismatched; recreating fresh object.`
      )
    }

    // Publish a fresh price feed object with current timestamps via the mock Pyth package.
    const createdFeed = await publishPriceFeed(
      {
        feedConfig,
        pythPackageId,
        pythStateObject,
        signer,
        clockObject
      },
      tooling
    )
    feeds.push(createdFeed)
  }

  return feeds
}

const refreshPriceFeeds = async (
  {
    pythPackageId,
    signer,
    clockObject,
    priceFeeds
  }: {
    pythPackageId: string
    signer: Ed25519Keypair
    clockObject: WrappedSuiSharedObject
    priceFeeds: PriceFeedArtifact[]
  },
  tooling: Tooling
) => {
  const updateTransaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
  const clockArgument = updateTransaction.sharedObjectRef(clockObject.sharedRef)

  let updatedCount = 0

  for (const priceFeed of priceFeeds) {
    const feedConfig = findMatchingFeedConfig(priceFeed)
    if (!feedConfig) {
      logWarning(
        `No matching feed configuration found for ${priceFeed.label}; skipping update.`
      )
      continue
    }

    const priceInfoSharedObject = await tooling.getSuiSharedObject({
      objectId: priceFeed.priceInfoObjectId,
      mutable: true
    })

    const priceInfoArgument = updateTransaction.sharedObjectRef(
      priceInfoSharedObject.sharedRef
    )

    const {
      priceMagnitude,
      priceIsNegative,
      exponentMagnitude,
      exponentIsNegative
    } = deriveMockPriceComponents(feedConfig)

    updateTransaction.moveCall({
      target: `${pythPackageId}::price_info::update_price_feed`,
      arguments: [
        priceInfoArgument,
        updateTransaction.pure.u64(priceMagnitude),
        updateTransaction.pure.bool(priceIsNegative),
        updateTransaction.pure.u64(feedConfig.confidence),
        updateTransaction.pure.u64(exponentMagnitude),
        updateTransaction.pure.bool(exponentIsNegative),
        clockArgument
      ]
    })

    updatedCount += 1
  }

  if (updatedCount === 0) return

  const { transactionResult } = await tooling.withTestnetFaucetRetry(
    {
      signerAddress: signer.toSuiAddress(),
      signer
    },
    async () =>
      await tooling.signAndExecute({
        transaction: updateTransaction,
        signer
      })
  )

  if (transactionResult.digest)
    logKeyValueGreen("refreshed-feeds")(transactionResult.digest)
  logKeyValueGreen("refreshed-feed-count")(String(updatedCount))
}

const findMatchingFeedConfig = (
  priceFeed: PriceFeedArtifact
): LabeledMockPriceFeedConfig | undefined =>
  DEFAULT_FEEDS.find((feedConfig) =>
    isMatchingMockPriceFeedConfig(feedConfig, priceFeed)
  )

const filterPriceFeedsToDefaults = (priceFeeds: PriceFeedArtifact[]) =>
  priceFeeds.filter((feed) => Boolean(findMatchingFeedConfig(feed)))

const publishPriceFeed = async (
  {
    feedConfig,
    pythPackageId,
    pythStateObject,
    signer,
    clockObject
  }: {
    feedConfig: LabeledMockPriceFeedConfig
    pythPackageId: string
    pythStateObject: WrappedSuiSharedObject
    signer: Ed25519Keypair
    clockObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<PriceFeedArtifact> => {
  const publishPriceFeedTransaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
  publishMockPriceFeed(
    publishPriceFeedTransaction,
    pythPackageId,
    publishPriceFeedTransaction.sharedObjectRef(pythStateObject.sharedRef),
    feedConfig,
    publishPriceFeedTransaction.sharedObjectRef(clockObject.sharedRef)
  )

  const { transactionResult } = await tooling.withTestnetFaucetRetry(
    {
      signerAddress: signer.toSuiAddress(),
      signer
    },
    async () =>
      await tooling.signAndExecute({
        transaction: publishPriceFeedTransaction,
        signer
      })
  )

  const [priceInfoObjectId] = findCreatedObjectIds(
    transactionResult,
    "::price_info::PriceInfoObject"
  )

  if (!priceInfoObjectId)
    throw new Error(`Missing price feed object for ${feedConfig.label}`)

  logKeyValueGreen("Feed")(`${feedConfig.label} ${priceInfoObjectId}`)

  return {
    label: feedConfig.label,
    feedIdHex: feedConfig.feedIdHex,
    priceInfoObjectId
  }
}

const buildCoinSeeds = (coinPackageId: string): CoinSeed[] => {
  const normalizedPackageId = normalizeSuiObjectId(coinPackageId)
  return [
    {
      label: "USDC",
      coinType: `${normalizedPackageId}::mock_coin::USDC`,
      initTarget: `${normalizedPackageId}::mock_coin::init_usdc`
    }
  ]
}

const findMatchingFeed = (
  existingPriceFeeds: PriceFeedArtifact[],
  feedConfig: LabeledMockPriceFeedConfig
) =>
  existingPriceFeeds.find((feed) =>
    isMatchingMockPriceFeedConfig(feedConfig, feed)
  )

const resolveTreasuryCoinSnapshot = async ({
  suiClient,
  owner,
  coinType,
  mintedCoinObjectId
}: {
  suiClient: SuiClient
  owner: string
  coinType: string
  mintedCoinObjectId?: string
}): Promise<SuiCoinBalance | undefined> => {
  try {
    const ownedCoins = await fetchCoinBalances(
      { owner, coinType },
      { suiClient }
    )
    if (!ownedCoins.length) return undefined

    const preferredCoinId = mintedCoinObjectId
      ? normalizeSuiObjectId(mintedCoinObjectId)
      : undefined

    const preferredCoin = preferredCoinId
      ? ownedCoins.find((coin) => coin.coinObjectId === preferredCoinId)
      : undefined

    const selectedCoin = preferredCoin ?? selectRichestCoin(ownedCoins)
    return selectedCoin
  } catch {
    return undefined
  }
}

const calculateQuarterBalance = (balance: bigint) => balance / 4n

const ensureSignerOwnsCoin = ({
  coinObjectId,
  coinOwnerAddress,
  signerAddress
}: {
  coinObjectId: string
  coinOwnerAddress: string
  signerAddress: string
}) => {
  if (
    normalizeSuiAddress(coinOwnerAddress) === normalizeSuiAddress(signerAddress)
  )
    return

  throw new Error(
    `Coin ${coinObjectId} is not owned by signer ${signerAddress} (owner ${coinOwnerAddress}).`
  )
}
