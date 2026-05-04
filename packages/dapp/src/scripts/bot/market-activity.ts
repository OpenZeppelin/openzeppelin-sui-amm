/**
 * Localnet-only. Spams a DeepBook pool with random market orders so the order
 * book has price/quantity flow for the UI's chart, fills, and inventory views.
 *
 * Each tick (single PTB, one signature):
 *   1. Walk the SUI/USD mock Pyth feed by a random step in
 *      `[-maxPriceDelta, +maxPriceDelta]` and call
 *      `pyth-mock::price_info::update_price_feed` so AMM quote refreshes pick
 *      up the new price. Skipped when `--max-price-delta 0`.
 *   2. Pick a random side — buy base (USDC → SUI) or sell base (SUI → USDC).
 *   3. Pick a random size up to `--max-base` SUI for sells or `--max-quote`
 *      USDC for buys.
 *   4. Submit the combined PTB and log the digest.
 *
 * Configuration:
 *   - Pool id, package ids, USDC coin type, and the SUI/USD PriceInfoObject id
 *     are sourced from `packages/dapp/deployments/mock.localnet.json`
 *     (populated by `mock:setup` and `mock:pool:create`).
 *   - Tick cadence and per-side caps come from CLI flags (`--interval-ms`,
 *     `--max-base`, `--max-quote`); defaults: 2000 ms, 1 SUI, 2 USDC.
 *   - Price walk: `--start-price` / `--max-price-delta` (human dollars). The
 *     mock feed has no auth on `update_price_feed`, so the bot's signer is
 *     enough.
 *   - The DEEP type tag is derived from the DeepBook package id — on localnet
 *     `sui client test-publish` inlines the token dep into deepbook itself, so
 *     `DEEP` lives at `<deepbookPackageId>::deep::DEEP`.
 *   - Signer is `MARKET_ACTIVITY_PRIVATE_KEY` from `packages/dapp/.env` when
 *     present (preferred — keeps the bot's coin objects from contending with
 *     the trader's gas/USDC objects in the UI). Falls back to the publisher's
 *     `TRADER_PRIVATE_KEY` when unset.
 */

import {
  FaucetRateLimitError,
  getFaucetHost,
  requestSuiFromFaucetV2
} from "@mysten/sui/faucet"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { Transaction } from "@mysten/sui/transactions"
import { normalizeStructTag } from "@mysten/sui/utils"
import yargs from "yargs"

import { SUI_USD_FEED } from "@sui-amm/domain-core/models/pyth"
import {
  fetchCoinBalances,
  selectRichestCoin
} from "@sui-amm/tooling-core/coin"
import { SUI_COIN_TYPE } from "@sui-amm/tooling-core/constants"
import { assertLocalnetNetwork } from "@sui-amm/tooling-core/network"
import { readArtifact } from "@sui-amm/tooling-node/artifacts"
import {
  DEFAULT_TX_GAS_BUDGET,
  SUI_CLOCK_ID
} from "@sui-amm/tooling-node/constants"
import { loadKeypair } from "@sui-amm/tooling-node/keypair"
import { logKeyValueGreen, logWarning } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { newTransaction } from "@sui-amm/tooling-node/transactions"

import { mockArtifactPath, type MockArtifact } from "../../utils/mocks.ts"

process.env.SUI_NETWORK = "localnet"

// Human → atom scaling.
const SUI_DECIMALS = 9n
const USDC_DECIMALS = 6n

const SUI_ATOMS_PER_UNIT = 10n ** SUI_DECIMALS
const USDC_ATOMS_PER_UNIT = 10n ** USDC_DECIMALS

// Below the pool's `min_size` (10_000_000 base atoms / 10 USDC quote atoms-equivalent
// for the localnet SUI/USDC pool) the swap is a no-op. Skip those iterations
// rather than burn gas on guaranteed-empty fills.
const MIN_BASE_ATOMS = 10_000_000n
const MIN_QUOTE_ATOMS = 1_000_000n

// Keep enough SUI in the publisher to pay gas after the seed split.
const PUBLISHER_GAS_HEADROOM_ATOMS = 5n * 1_000_000_000n
// Localnet faucet hands out ~200 SUI per call; cap requests so the script
// fails fast instead of hammering the faucet forever when the requested seed
// is unreasonably large.
const MAX_FAUCET_REQUESTS = 600
// Gentle pacing between faucet calls so we don't trip rate limiting; the
// faucet itself will surface `FaucetRateLimitError` and we back off further.
const FAUCET_REQUEST_PAUSE_MS = 100
// Sui caps a transaction's gas payment at 256 coins, so the SUI seed can pin
// at most that many of the publisher's SUI coins for auto-merge into `tx.gas`.
// At ~200 SUI per faucet call that bounds a single seed transaction at ~50k
// SUI; larger asks would need batching.
const MAX_GAS_PAYMENT_COINS = 256

// Pyth price-walk parameters. The mock SUI/USD feed stores price as a u64
// magnitude with an `exponent` field; SUI_USD_FEED.exponent = -2 means the
// human-dollar value is `magnitude / 10^2`. PRICE_SCALE bridges human dollars
// (CLI args) to the on-chain magnitude. MIN_PRICE_DOLLARS keeps a random
// downward walk from clamping the price to zero or below.
const PRICE_SCALE = 10 ** Math.abs(SUI_USD_FEED.exponent)
const MIN_PRICE_DOLLARS = 0.01

const requireMockField = <T>(value: T | undefined, label: string): T => {
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `${label} is missing from mock.localnet.json. Run \`pnpm --filter dapp mock:setup\` first.`
    )
  }
  return value
}

const randomBigIntInRange = (minInclusive: bigint, maxExclusive: bigint): bigint => {
  if (maxExclusive <= minInclusive) return minInclusive
  const span = Number(maxExclusive - minInclusive)
  return minInclusive + BigInt(Math.floor(Math.random() * span))
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

runSuiScript(
  async (tooling, cliArguments) => {
    const {
      suiConfig: { network }
    } = tooling
    assertLocalnetNetwork(network.networkName)

    const intervalMs = cliArguments.intervalMs
    const maxBase = cliArguments.maxBase
    const maxQuote = cliArguments.maxQuote
    const startPriceDollars = cliArguments.startPrice
    const maxPriceDeltaDollars = cliArguments.maxPriceDelta

    const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
    const deepbookPackageId = requireMockField(
      mockArtifact.deepbookPackageId,
      "deepbookPackageId"
    )
    const pythPackageId = requireMockField(
      mockArtifact.pythPackageId,
      "pythPackageId"
    )
    const poolFromArtifact = mockArtifact.pools?.[0]
    const poolId =
      cliArguments.poolId ??
      requireMockField(poolFromArtifact?.poolId, "pools[0].poolId")
    const usdcCoin = mockArtifact.coins?.find((coin) => coin.label === "USDC")
    if (!usdcCoin) {
      throw new Error(
        "USDC mock coin missing from mock.localnet.json; re-run mock:setup."
      )
    }
    const suiUsdFeed = mockArtifact.priceFeeds?.find(
      (feed) => feed.label === "SUI_USD"
    )
    if (maxPriceDeltaDollars > 0 && !suiUsdFeed?.priceInfoObjectId) {
      throw new Error(
        "SUI_USD price feed missing from mock.localnet.json; re-run mock:setup."
      )
    }

    const baseCoinType = normalizeStructTag(SUI_COIN_TYPE)
    const quoteCoinType = normalizeStructTag(usdcCoin.coinType)
    // `sui client test-publish` inlines the deepbook token dep into the
    // deepbook package itself on localnet, so `DEEP` lives at
    // `<deepbookPackageId>::deep::DEEP` — verified via dev-inspect on
    // `pool::swap_exact_base_for_quote`.
    const deepCoinType = `${deepbookPackageId}::deep::DEEP`

    // Prefer a dedicated bot keypair so the activity script doesn't bump the
    // trader's gas/USDC coins under the UI's feet (mid-flight transactions
    // would fail with `Transaction needs to be rebuilt because object …
    // unavailable for consumption`). Falls back to the publisher key when
    // unset so existing single-account setups still work.
    const botPrivateKey = process.env.MARKET_ACTIVITY_PRIVATE_KEY?.trim()
    const signer = botPrivateKey
      ? await loadKeypair({ accountPrivateKey: botPrivateKey })
      : tooling.loadedEd25519KeyPair
    const ownerAddress = signer.toSuiAddress()

    if (botPrivateKey) {
      // Top up SUI gas for the bot via the localnet faucet (covers the first
      // `splitCoins` + transfer in the SUI seed below).
      await tooling.ensureFoundedAddress({
        signerAddress: ownerAddress,
        signer
      })
      // Top up SUI by transferring from the publisher's gas coin. SUI can't
      // be minted by anyone other than the system, so we move it from the
      // address that already holds faucet-funded SUI.
      await ensureBotSuiSeeded({
        tooling,
        publisherKeypair: tooling.loadedEd25519KeyPair,
        botAddress: ownerAddress,
        seedAtoms: BigInt(
          Math.floor(cliArguments.seedBaseSui * Number(SUI_ATOMS_PER_UNIT))
        )
      })
      // Top up USDC by minting from the publisher's TreasuryCap. Idempotent:
      // skipped when the bot already holds at least `seedQuoteUsdc` USDC.
      await ensureBotUsdcSeeded({
        tooling,
        publisherKeypair: tooling.loadedEd25519KeyPair,
        botAddress: ownerAddress,
        usdcCoinType: quoteCoinType,
        treasuryCapId: usdcCoin.treasuryCapId,
        seedAtoms: BigInt(
          Math.floor(cliArguments.seedQuoteUsdc * Number(USDC_ATOMS_PER_UNIT))
        )
      })
    }

    logKeyValueGreen("pool")(poolId)
    logKeyValueGreen("deepbook")(deepbookPackageId)
    logKeyValueGreen("base")(baseCoinType)
    logKeyValueGreen("quote")(quoteCoinType)
    logKeyValueGreen("signer")(ownerAddress)
    logKeyValueGreen("interval-ms")(String(intervalMs))
    logKeyValueGreen("max-base")(`${maxBase} SUI`)
    logKeyValueGreen("max-quote")(`${maxQuote} USDC`)
    if (maxPriceDeltaDollars > 0) {
      logKeyValueGreen("price-walk")(
        `start=$${startPriceDollars.toFixed(2)} · max-delta=±$${maxPriceDeltaDollars.toFixed(2)}`
      )
    } else {
      logKeyValueGreen("price-walk")("disabled (--max-price-delta=0)")
    }

    const poolShared = await tooling.getMutableSharedObject({ objectId: poolId })
    const priceInfoShared =
      maxPriceDeltaDollars > 0 && suiUsdFeed?.priceInfoObjectId
        ? await tooling.getMutableSharedObject({
            objectId: suiUsdFeed.priceInfoObjectId
          })
        : undefined

    // Caps are interpreted as human-denominated upper bounds.
    const maxBaseAtoms = BigInt(
      Math.floor(maxBase * Number(SUI_ATOMS_PER_UNIT))
    )
    const maxQuoteAtoms = BigInt(
      Math.floor(maxQuote * Number(USDC_ATOMS_PER_UNIT))
    )

    let currentPriceDollars = startPriceDollars
    let tick = 0
    // Loop forever until the user Ctrl-Cs the script. Any per-iteration error
    // (insufficient funds, transient RPC failure) is logged and the loop
    // continues so a brief outage doesn't kill the whole producer.
    while (true) {
      tick += 1
      const isSellBase = Math.random() < 0.5

      try {
        const transaction = newTransaction(DEFAULT_TX_GAS_BUDGET)

        if (priceInfoShared) {
          // Uniform random step in [-maxPriceDeltaDollars, +maxPriceDeltaDollars].
          const step = (Math.random() * 2 - 1) * maxPriceDeltaDollars
          currentPriceDollars = Math.max(
            MIN_PRICE_DOLLARS,
            currentPriceDollars + step
          )
          const priceMagnitude = BigInt(
            Math.max(1, Math.round(currentPriceDollars * PRICE_SCALE))
          )
          addPriceUpdate(transaction, {
            pythPackageId,
            priceInfoSharedRef: priceInfoShared.sharedRef,
            priceMagnitude
          })
        }

        let swapDescription: string | undefined
        if (isSellBase) {
          const baseAtoms = randomBigIntInRange(MIN_BASE_ATOMS, maxBaseAtoms)
          addSellBase(transaction, {
            ownerAddress,
            deepbookPackageId,
            poolSharedRef: poolShared.sharedRef,
            baseCoinType,
            quoteCoinType,
            deepCoinType,
            baseAtoms
          })
          swapDescription = `sell-base ${baseAtoms.toString()} base-atoms`
        } else {
          const quoteAtoms = randomBigIntInRange(MIN_QUOTE_ATOMS, maxQuoteAtoms)
          const ownedQuoteCoins = await fetchCoinBalances(
            { owner: ownerAddress, coinType: quoteCoinType },
            { suiClient: tooling.suiClient }
          )
          const richestQuote = selectRichestCoin(ownedQuoteCoins)
          if (!richestQuote || BigInt(richestQuote.balance) < quoteAtoms) {
            logWarning(
              `tick ${tick} buy-base skipped: not enough USDC (need ${quoteAtoms.toString()} atoms, have ${
                richestQuote?.balance ?? "0"
              })`
            )
          } else {
            addBuyBase(transaction, {
              ownerAddress,
              deepbookPackageId,
              poolSharedRef: poolShared.sharedRef,
              baseCoinType,
              quoteCoinType,
              deepCoinType,
              quoteAtoms,
              quoteCoinObjectId: richestQuote.coinObjectId
            })
            swapDescription = `buy-base ${quoteAtoms.toString()} quote-atoms`
          }
        }

        if (priceInfoShared || swapDescription) {
          const { transactionResult } = await tooling.signAndExecute({
            transaction,
            signer,
            // Per-tick swaps churn `Coin<T>` outputs and racing other scripts
            // on the artifact ledger has corrupted it before. We don't read
            // the ledger here, so opting out keeps the file clean.
            persistCreatedObjects: false
          })
          const priceLabel = priceInfoShared
            ? `price=$${currentPriceDollars.toFixed(2)}`
            : undefined
          const fragments = [swapDescription, priceLabel].filter(Boolean)
          logKeyValueGreen(`tick ${tick}`)(
            `${fragments.join(" · ")} · digest=${transactionResult.digest}`
          )
        }
      } catch (error) {
        logWarning(
          `tick ${tick} failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }

      await sleep(intervalMs)
    }
  },
  yargs()
    .option("poolId", {
      alias: ["pool-id"],
      type: "string",
      description:
        "DeepBook pool object id; defaults to pools[0].poolId from mock.localnet.json"
    })
    .option("intervalMs", {
      alias: ["interval-ms", "interval"],
      type: "number",
      description: "Delay between market orders, in milliseconds",
      default: 2000
    })
    .option("maxBase", {
      alias: ["max-base"],
      type: "number",
      description: "Upper bound for base-side (SUI) order size, in human SUI",
      default: 1
    })
    .option("maxQuote", {
      alias: ["max-quote"],
      type: "number",
      description: "Upper bound for quote-side (USDC) order size, in human USDC",
      default: 2
    })
    .option("seedBaseSui", {
      alias: ["seed-base-sui", "seed-base"],
      type: "number",
      description:
        "Top up the bot's SUI balance to this amount (in human SUI) on startup; transferred from the publisher's gas coin. Only runs when MARKET_ACTIVITY_PRIVATE_KEY is set.",
      default: 100000
    })
    .option("seedQuoteUsdc", {
      alias: ["seed-quote-usdc", "seed-quote"],
      type: "number",
      description:
        "Top up the bot's USDC balance to this amount (in human USDC) on startup; minted from the publisher's TreasuryCap. Only runs when MARKET_ACTIVITY_PRIVATE_KEY is set.",
      default: 100000
    })
    .option("startPrice", {
      alias: ["start-price"],
      type: "number",
      description:
        "Initial SUI/USD price in human dollars. Each tick the script walks this value by a random step in [-maxPriceDelta, +maxPriceDelta] and writes it to the mock Pyth SUI_USD PriceInfoObject before the market order.",
      default: Number(SUI_USD_FEED.price) / PRICE_SCALE
    })
    .option("maxPriceDelta", {
      alias: ["max-price-delta"],
      type: "number",
      description:
        "Maximum per-tick SUI/USD price step in human dollars (positive). The bot picks the step uniformly from [-maxPriceDelta, +maxPriceDelta]. Set to 0 to disable price updates.",
      default: 0.05
    })
    .strict()
)

const sumSuiAtoms = async (
  tooling: Parameters<Parameters<typeof runSuiScript>[0]>[0],
  address: string
) => {
  const owned = await fetchCoinBalances(
    { owner: address, coinType: SUI_COIN_TYPE },
    { suiClient: tooling.suiClient }
  )
  return owned.reduce((total, coin) => total + BigInt(coin.balance), 0n)
}

// Pumps the localnet faucet at `publisherAddress` until the publisher holds at
// least `requiredAtoms`. The faucet hands out ~200 SUI per call, so seeding
// 100k SUI realistically requires hundreds of calls — `MAX_FAUCET_REQUESTS`
// caps the loop so the script fails fast on a stuck faucet. Returns the final
// observed balance so callers can decide how much they're allowed to transfer.
const topUpPublisherSuiViaFaucet = async ({
  tooling,
  publisherAddress,
  requiredAtoms
}: {
  tooling: Parameters<Parameters<typeof runSuiScript>[0]>[0]
  publisherAddress: string
  requiredAtoms: bigint
}): Promise<bigint> => {
  const faucetHost =
    tooling.suiConfig.network.faucetUrl?.trim() || getFaucetHost("localnet")

  let publisherAtoms = await sumSuiAtoms(tooling, publisherAddress)
  if (publisherAtoms >= requiredAtoms) return publisherAtoms

  let requests = 0
  let lastError: unknown
  while (
    publisherAtoms < requiredAtoms &&
    requests < MAX_FAUCET_REQUESTS
  ) {
    try {
      await requestSuiFromFaucetV2({
        host: faucetHost,
        recipient: publisherAddress
      })
      requests += 1
    } catch (error) {
      lastError = error
      if (error instanceof FaucetRateLimitError) {
        await sleep(500 * (requests + 1) + 250)
        continue
      }
      // Any other faucet error is unlikely to clear on its own; bail and let
      // the caller decide how to react with whatever we already topped up.
      break
    }
    if (FAUCET_REQUEST_PAUSE_MS > 0) await sleep(FAUCET_REQUEST_PAUSE_MS)
    publisherAtoms = await sumSuiAtoms(tooling, publisherAddress)
  }

  logKeyValueGreen("bot-sui-faucet")(
    `${requests} requests · publisher now holds ${publisherAtoms.toString()} atoms`
  )
  if (publisherAtoms < requiredAtoms && lastError) {
    logWarning(
      `faucet stopped before reaching target: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    )
  }
  return publisherAtoms
}

const ensureBotSuiSeeded = async ({
  tooling,
  publisherKeypair,
  botAddress,
  seedAtoms
}: {
  tooling: Parameters<Parameters<typeof runSuiScript>[0]>[0]
  publisherKeypair: Ed25519Keypair
  botAddress: string
  seedAtoms: bigint
}) => {
  if (seedAtoms <= 0n) return

  const heldAtoms = await sumSuiAtoms(tooling, botAddress)
  if (heldAtoms >= seedAtoms) {
    logKeyValueGreen("bot-sui")(`${heldAtoms.toString()} atoms (no top-up)`)
    return
  }
  const requestedTransferAtoms = seedAtoms - heldAtoms

  // SUI is not mintable, so the seed has to come from an address the faucet
  // funded. Top the publisher up first so a single split can carry the whole
  // delta in one transaction.
  const publisherAddress = publisherKeypair.toSuiAddress()
  await topUpPublisherSuiViaFaucet({
    tooling,
    publisherAddress,
    requiredAtoms: requestedTransferAtoms + PUBLISHER_GAS_HEADROOM_ATOMS
  })

  // Localnet faucet calls each create a fresh ~200 SUI coin object, so the
  // publisher ends up with many small coins. `splitCoins(tx.gas, ...)` only
  // operates on whichever single coin Sui picks for gas payment, so pin all
  // SUI coins as the gas payment set — Sui merges them into `tx.gas` before
  // the split runs. The pool is bounded by `MAX_GAS_PAYMENT_COINS`, which
  // also caps how much SUI a single seed tx can transfer.
  const publisherCoinPage = await tooling.suiClient.getCoins({
    owner: publisherAddress,
    coinType: SUI_COIN_TYPE,
    limit: MAX_GAS_PAYMENT_COINS
  })
  if (publisherCoinPage.data.length === 0) {
    logWarning("skip SUI seed: publisher has no SUI coins to spend")
    return
  }

  // Cap by what's actually spendable in one tx (sum of pinned coins minus
  // gas headroom), not by the publisher's total balance — the rest is held
  // in coins the gas-payment array can't fit.
  const pinnedAtoms = publisherCoinPage.data.reduce(
    (total, coin) => total + BigInt(coin.balance),
    0n
  )
  const spendable =
    pinnedAtoms > PUBLISHER_GAS_HEADROOM_ATOMS
      ? pinnedAtoms - PUBLISHER_GAS_HEADROOM_ATOMS
      : 0n
  const transferAtoms =
    requestedTransferAtoms < spendable ? requestedTransferAtoms : spendable
  if (transferAtoms <= 0n) {
    logWarning(
      `skip SUI seed: publisher's first ${publisherCoinPage.data.length} SUI coins only hold ${pinnedAtoms.toString()} atoms (need ${(requestedTransferAtoms + PUBLISHER_GAS_HEADROOM_ATOMS).toString()})`
    )
    return
  }
  if (transferAtoms < requestedTransferAtoms) {
    logWarning(
      `SUI seed capped to ${transferAtoms.toString()} atoms (requested ${requestedTransferAtoms.toString()}); single-tx limit is ${MAX_GAS_PAYMENT_COINS} gas-payment coins`
    )
  }

  const transaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
  transaction.setGasPayment(
    publisherCoinPage.data.map((coin) => ({
      objectId: coin.coinObjectId,
      version: coin.version,
      digest: coin.digest
    }))
  )
  const [topUp] = transaction.splitCoins(transaction.gas, [
    transaction.pure.u64(transferAtoms)
  ])
  transaction.transferObjects([topUp], transaction.pure.address(botAddress))

  const { transactionResult } = await tooling.signAndExecute({
    transaction,
    signer: publisherKeypair,
    persistCreatedObjects: false
  })
  logKeyValueGreen("bot-sui-seeded")(
    `${transferAtoms.toString()} atoms · digest=${transactionResult.digest}`
  )
}

const ensureBotUsdcSeeded = async ({
  tooling,
  publisherKeypair,
  botAddress,
  usdcCoinType,
  treasuryCapId,
  seedAtoms
}: {
  tooling: Parameters<Parameters<typeof runSuiScript>[0]>[0]
  publisherKeypair: Ed25519Keypair
  botAddress: string
  usdcCoinType: string
  treasuryCapId: string | undefined
  seedAtoms: bigint
}) => {
  if (seedAtoms <= 0n) return
  if (!treasuryCapId) {
    logWarning(
      "skip USDC seed: treasuryCapId missing from mock.localnet.json (re-run mock:setup)."
    )
    return
  }

  const owned = await fetchCoinBalances(
    { owner: botAddress, coinType: usdcCoinType },
    { suiClient: tooling.suiClient }
  )
  const heldAtoms = owned.reduce(
    (total, coin) => total + BigInt(coin.balance),
    0n
  )
  if (heldAtoms >= seedAtoms) {
    logKeyValueGreen("bot-usdc")(`${heldAtoms.toString()} atoms (no top-up)`)
    return
  }

  // Mint the difference. The TreasuryCap is owned by the publisher (set up by
  // `mock:setup`'s `init_usdc` move call), so the publisher signs this top-up.
  const mintAtoms = seedAtoms - heldAtoms
  const transaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
  transaction.moveCall({
    target: "0x2::coin::mint_and_transfer",
    typeArguments: [usdcCoinType],
    arguments: [
      transaction.object(treasuryCapId),
      transaction.pure.u64(mintAtoms),
      transaction.pure.address(botAddress)
    ]
  })
  const { transactionResult } = await tooling.signAndExecute({
    transaction,
    signer: publisherKeypair,
    persistCreatedObjects: false
  })
  logKeyValueGreen("bot-usdc-seeded")(
    `${mintAtoms.toString()} atoms · digest=${transactionResult.digest}`
  )
}

type SharedRef = Parameters<
  ReturnType<typeof newTransaction>["sharedObjectRef"]
>[0]

const addSellBase = (
  transaction: Transaction,
  {
    ownerAddress,
    deepbookPackageId,
    poolSharedRef,
    baseCoinType,
    quoteCoinType,
    deepCoinType,
    baseAtoms
  }: {
    ownerAddress: string
    deepbookPackageId: string
    poolSharedRef: SharedRef
    baseCoinType: string
    quoteCoinType: string
    deepCoinType: string
    baseAtoms: bigint
  }
) => {
  const [baseIn] = transaction.splitCoins(transaction.gas, [
    transaction.pure.u64(baseAtoms)
  ])
  const deepIn = transaction.moveCall({
    target: "0x2::coin::zero",
    typeArguments: [deepCoinType]
  })
  const [baseRem, quoteOut, deepOut] = transaction.moveCall({
    target: `${deepbookPackageId}::pool::swap_exact_base_for_quote`,
    typeArguments: [baseCoinType, quoteCoinType],
    arguments: [
      transaction.sharedObjectRef(poolSharedRef),
      baseIn,
      deepIn,
      transaction.pure.u64(0),
      transaction.object(SUI_CLOCK_ID)
    ]
  })
  transaction.transferObjects(
    [baseRem, quoteOut, deepOut],
    transaction.pure.address(ownerAddress)
  )
}

const addBuyBase = (
  transaction: Transaction,
  {
    ownerAddress,
    deepbookPackageId,
    poolSharedRef,
    baseCoinType,
    quoteCoinType,
    deepCoinType,
    quoteAtoms,
    quoteCoinObjectId
  }: {
    ownerAddress: string
    deepbookPackageId: string
    poolSharedRef: SharedRef
    baseCoinType: string
    quoteCoinType: string
    deepCoinType: string
    quoteAtoms: bigint
    quoteCoinObjectId: string
  }
) => {
  const [quoteIn] = transaction.splitCoins(
    transaction.object(quoteCoinObjectId),
    [transaction.pure.u64(quoteAtoms)]
  )
  const deepIn = transaction.moveCall({
    target: "0x2::coin::zero",
    typeArguments: [deepCoinType]
  })
  const [baseOut, quoteRem, deepOut] = transaction.moveCall({
    target: `${deepbookPackageId}::pool::swap_exact_quote_for_base`,
    typeArguments: [baseCoinType, quoteCoinType],
    arguments: [
      transaction.sharedObjectRef(poolSharedRef),
      quoteIn,
      deepIn,
      transaction.pure.u64(0),
      transaction.object(SUI_CLOCK_ID)
    ]
  })
  transaction.transferObjects(
    [baseOut, quoteRem, deepOut],
    transaction.pure.address(ownerAddress)
  )
}

/**
 * Adds a `pyth-mock::price_info::update_price_feed` call that overwrites the
 * SUI/USD feed with a fresh magnitude (still at the SUI_USD_FEED exponent).
 * The mock has no auth on this entrypoint, so the bot's signer is enough.
 */
const addPriceUpdate = (
  transaction: Transaction,
  {
    pythPackageId,
    priceInfoSharedRef,
    priceMagnitude
  }: {
    pythPackageId: string
    priceInfoSharedRef: SharedRef
    priceMagnitude: bigint
  }
) => {
  transaction.moveCall({
    target: `${pythPackageId}::price_info::update_price_feed`,
    arguments: [
      transaction.sharedObjectRef(priceInfoSharedRef),
      transaction.pure.u64(priceMagnitude),
      transaction.pure.bool(false),
      transaction.pure.u64(SUI_USD_FEED.confidence),
      transaction.pure.u64(Math.abs(SUI_USD_FEED.exponent)),
      transaction.pure.bool(SUI_USD_FEED.exponent < 0),
      transaction.object(SUI_CLOCK_ID)
    ]
  })
}
