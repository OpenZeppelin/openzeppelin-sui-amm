/**
 * Localnet bootstrap: publishes mock Move packages (coins/Pyth) and seeds objects.
 * Publishes packages, records artifacts, and reuses them to keep runs idempotent.
 */

import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { ensureSignerOwnsCoin } from "@sui-amm/domain-core/models/currency"
import {
  deriveMockPriceComponents,
  findMockPriceFeedConfig,
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
import { readArtifact } from "@sui-amm/tooling-node/artifacts"
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
  findCreatedObjectIds,
  newTransaction
} from "@sui-amm/tooling-node/transactions"
import { DEFAULT_PYTH_PRICE_FEED_LABEL } from "../../utils/amm.ts"
import type {
  CoinArtifact,
  MockArtifact,
  PriceFeedArtifact
} from "../../utils/mocks.ts"
import {
  DEFAULT_COIN_CONTRACT_PATH,
  DEFAULT_PYTH_CONTRACT_PATH,
  mockArtifactPath,
  writeMockArtifact
} from "../../utils/mocks.ts"

type SetupLocalCliArgs = {
  buyerAddress?: string
  coinPackageId?: string
  coinContractPath: string
  pythPackageId?: string
  pythContractPath: string
  rePublish?: boolean
  useCliPublish?: boolean
}

type ExistingState = {
  existingCoinPackageId?: string
  existingCoins?: CoinArtifact[]
  existingPythPackageId?: string
  existingPriceFeeds?: PriceFeedArtifact[]
}

const PACKAGE_AVAILABILITY_TIMEOUT_MS = 20_000
const PACKAGE_AVAILABILITY_INTERVAL_MS = 250

type SeededCoin = {
  coin: CoinArtifact
  wasCreated: boolean
}

type CoinSeed = {
  label: string
  coinType: string
  initTarget: string
}

const resolveDefaultFeedConfigs = (
  label: string
): LabeledMockPriceFeedConfig[] => {
  const feedConfig = findMockPriceFeedConfig({ label })
  if (!feedConfig)
    throw new Error(`Missing mock price feed config for ${label}.`)
  return [feedConfig]
}

// Single feed to seed the SUI/USD price object with.
const DEFAULT_FEEDS: LabeledMockPriceFeedConfig[] = resolveDefaultFeedConfigs(
  DEFAULT_PYTH_PRICE_FEED_LABEL
)

const normalizeSetupInputs = (
  cliArguments: SetupLocalCliArgs
): SetupLocalCliArgs => ({
  ...cliArguments,
  buyerAddress: cliArguments.buyerAddress
    ? normalizeSuiAddress(cliArguments.buyerAddress)
    : undefined
})

// Parse CLI flags and reuse prior mock artifacts unless --re-publish is set.
const extendCliArguments = async (
  baseScriptArguments: SetupLocalCliArgs
): Promise<ExistingState> => {
  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})

  return {
    ...baseScriptArguments,
    existingPythPackageId: baseScriptArguments.rePublish
      ? undefined
      : baseScriptArguments.pythPackageId || mockArtifact.pythPackageId,
    existingCoinPackageId: baseScriptArguments.rePublish
      ? undefined
      : baseScriptArguments.coinPackageId || mockArtifact.coinPackageId,
    existingPriceFeeds: baseScriptArguments.rePublish
      ? undefined
      : mockArtifact.priceFeeds,
    existingCoins: baseScriptArguments.rePublish
      ? undefined
      : mockArtifact.coins
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
    const { coinPackageId, pythPackageId } = await publishMockPackages(
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

    if (inputs.buyerAddress)
      await transferHalfTreasuryToBuyer(
        {
          coins: createdCoins,
          buyerAddress: inputs.buyerAddress,
          signer: tooling.loadedEd25519KeyPair,
          signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress()
        },
        tooling
      )
    else logWarning("--buyer-address not supplied skipping fund transfer")

    // Ensure mock price feeds exist with fresh timestamps; reuse if valid objects already present.
    const desiredExistingPriceFeeds = filterPriceFeedsToDefaults(
      existingState.existingPriceFeeds || []
    )
    const priceFeeds = await ensurePriceFeeds(
      {
        pythPackageId,
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
    logKeyValueGreen("Feeds")(JSON.stringify(priceFeeds))
    logKeyValueGreen("Coins")(JSON.stringify(coins))
  },
  yargs()
    .option("buyerAddress", {
      alias: ["buyer-address", "buyer"],
      type: "string",
      description: "Buyer address to receive quarter of each minted mock coin"
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
    .option("pythPackageId", {
      alias: "pyth-package-id",
      type: "string",
      description:
        "Package ID of the Pyth Move package on the local localNetwork"
    })
    .option("pythContractPath", {
      alias: "pyth-contract-path",
      type: "string",
      description: "Path to the local Pyth stub Move package to publish",
      default: DEFAULT_PYTH_CONTRACT_PATH
    })
    .option("rePublish", {
      alias: "re-publish",
      type: "boolean",
      description: `Re-create and overwrite local mock data`,
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

const publishMockPackages = async (
  {
    cliArguments,
    existingState
  }: {
    cliArguments: SetupLocalCliArgs
    existingState: ExistingState
  },
  tooling: Tooling
) => {
  // Publish or reuse the local Pyth stub. We allow unpublished deps here because this is localnet-only.
  const pythPackageId =
    existingState.existingPythPackageId ||
    (
      await tooling.publishMovePackageWithFunding({
        packagePath: cliArguments.pythContractPath,
        withUnpublishedDependencies: true,
        clearPublishedEntry: true,
        useCliPublish: cliArguments.useCliPublish
      })
    ).packageId

  if (pythPackageId !== existingState.existingPythPackageId)
    await waitForPackageAvailability(
      pythPackageId,
      tooling.suiClient,
      "pyth-mock"
    )

  if (pythPackageId !== existingState.existingPythPackageId)
    await writeMockArtifact(mockArtifactPath, {
      pythPackageId
    })

  // Publish or reuse the local mock coin package.
  const coinPackageId =
    existingState.existingCoinPackageId ||
    (
      await tooling.publishMovePackageWithFunding({
        packagePath: cliArguments.coinContractPath,
        clearPublishedEntry: true,
        useCliPublish: cliArguments.useCliPublish
      })
    ).packageId

  if (coinPackageId !== existingState.existingCoinPackageId)
    await waitForPackageAvailability(
      coinPackageId,
      tooling.suiClient,
      "coin-mock"
    )

  if (coinPackageId !== existingState.existingCoinPackageId)
    await writeMockArtifact(mockArtifactPath, {
      coinPackageId
    })

  return {
    pythPackageId,
    coinPackageId
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

const transferHalfTreasuryToBuyer = async (
  {
    coins,
    buyerAddress,
    signer,
    signerAddress
  }: {
    coins: CoinArtifact[]
    buyerAddress: string
    signer: Ed25519Keypair
    signerAddress: string
  },
  tooling: Tooling
) => {
  if (coins.length === 0) return

  for (const coin of coins) {
    await transferHalfTreasuryForCoin(
      {
        coin,
        buyerAddress,
        signer,
        signerAddress
      },
      tooling
    )
  }
}

const transferHalfTreasuryForCoin = async (
  {
    coin,
    buyerAddress,
    signer,
    signerAddress
  }: {
    coin: CoinArtifact
    buyerAddress: string
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
      `No coin objects found for ${coin.label} (${coin.coinType}); skipping buyer transfer.`
    )
    return
  }

  const transferAmount = calculateQuarterBalance(treasurySnapshot.balance)
  if (transferAmount <= 0n) {
    logWarning(
      `Balance too small to split for ${coin.label} (${coin.coinType}); skipping buyer transfer.`
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
    recipientAddress: buyerAddress
  })

  const { transactionResult } = await tooling.signAndExecute({
    transaction: transferTransaction,
    signer
  })

  logKeyValueGreen("Buyer transfer")(`${coin.label} ${coin.coinType}`)
  logKeyValueGreen("amount")(transferAmount.toString())
  logKeyValueGreen("from")(signerAddress)
  logKeyValueGreen("to")(buyerAddress)
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
    signer,
    existingPriceFeeds,
    clockObject
  }: {
    pythPackageId: string
    signer: Ed25519Keypair
    existingPriceFeeds: PriceFeedArtifact[]
    clockObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<PriceFeedArtifact[]> => {
  const priceInfoType = getPythPriceInfoType(pythPackageId)
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
    signer,
    clockObject
  }: {
    feedConfig: LabeledMockPriceFeedConfig
    pythPackageId: string
    signer: Ed25519Keypair
    clockObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<PriceFeedArtifact> => {
  const publishPriceFeedTransaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
  publishMockPriceFeed(
    publishPriceFeedTransaction,
    pythPackageId,
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
      label: "LocalMockUsd",
      coinType: `${normalizedPackageId}::mock_coin::LocalMockUsd`,
      initTarget: `${normalizedPackageId}::mock_coin::init_local_mock_usd`
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
