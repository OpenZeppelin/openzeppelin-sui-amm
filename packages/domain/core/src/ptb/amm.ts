import { SUI_CLOCK_ID } from "@sui-amm/tooling-core/constants"
import {
  assertByteArrayLength,
  assertBytesLength,
  hexToBytes
} from "@sui-amm/tooling-core/hex"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { newTransaction } from "@sui-amm/tooling-core/transactions"
import { validateRequiredHexBytes } from "@sui-amm/tooling-core/utils/validation"

const PYTH_PRICE_FEED_ID_BYTES = 32

export const parsePythPriceFeedIdBytes = (
  pythPriceFeedIdHex: string
): number[] => {
  const trimmedPythPriceFeedIdHex = pythPriceFeedIdHex.trim()
  const validationError = validateRequiredHexBytes({
    value: trimmedPythPriceFeedIdHex,
    expectedBytes: PYTH_PRICE_FEED_ID_BYTES,
    label: "Pyth price feed id"
  })

  if (validationError) {
    throw new Error(validationError)
  }

  return assertBytesLength(
    hexToBytes(trimmedPythPriceFeedIdHex),
    PYTH_PRICE_FEED_ID_BYTES
  )
}

export const buildCreateExecutorTransaction = ({
  packageId,
  pool,
  baseCurrency,
  quoteCurrency,
  baseAssetTypeTag,
  quoteAssetTypeTag,
  senderAddress,
  baseSpreadBps,
  volatilityMultiplierBps,
  basePythPriceFeedIdBytes,
  quotePythPriceFeedIdBytes,
  orderExpirationTimeMs,
  maxPriceAgeSecs,
  maxConfRatioBps,
  outerBalanceBps,
  inventorySkewBps
}: {
  packageId: string
  pool: WrappedSuiSharedObject
  baseCurrency: WrappedSuiSharedObject
  quoteCurrency: WrappedSuiSharedObject
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
  senderAddress: string
  baseSpreadBps: bigint | number
  volatilityMultiplierBps: bigint | number
  basePythPriceFeedIdBytes: number[]
  quotePythPriceFeedIdBytes: number[]
  orderExpirationTimeMs: bigint | number
  maxPriceAgeSecs: bigint | number
  maxConfRatioBps: bigint | number
  outerBalanceBps: bigint | number
  inventorySkewBps: bigint | number
}) => {
  const validatedBasePythPriceFeedIdBytes = assertByteArrayLength(
    basePythPriceFeedIdBytes,
    PYTH_PRICE_FEED_ID_BYTES,
    "basePythPriceFeedIdBytes"
  )
  const validatedQuotePythPriceFeedIdBytes = assertByteArrayLength(
    quotePythPriceFeedIdBytes,
    PYTH_PRICE_FEED_ID_BYTES,
    "quotePythPriceFeedIdBytes"
  )
  const transaction = newTransaction()

  const market = transaction.moveCall({
    target: `${packageId}::market::new`,
    typeArguments: [baseAssetTypeTag, quoteAssetTypeTag],
    arguments: [
      transaction.sharedObjectRef(pool.sharedRef),
      transaction.sharedObjectRef(baseCurrency.sharedRef),
      transaction.sharedObjectRef(quoteCurrency.sharedRef),
      transaction.pure.vector("u8", validatedBasePythPriceFeedIdBytes),
      transaction.pure.vector("u8", validatedQuotePythPriceFeedIdBytes)
    ]
  })

  const ammConfig = transaction.moveCall({
    target: `${packageId}::config::new`,
    arguments: [
      transaction.pure.u64(baseSpreadBps),
      transaction.pure.u64(volatilityMultiplierBps),
      transaction.pure.u64(orderExpirationTimeMs),
      transaction.pure.u64(maxPriceAgeSecs),
      transaction.pure.u64(maxConfRatioBps),
      transaction.pure.u64(outerBalanceBps),
      transaction.pure.u64(inventorySkewBps)
    ]
  })

  const [executor, adminCap] = transaction.moveCall({
    target: `${packageId}::executor::create`,
    arguments: [market, ammConfig]
  })

  transaction.moveCall({
    target: "0x2::transfer::public_share_object",
    typeArguments: [`${packageId}::executor::Executor`],
    arguments: [executor]
  })

  transaction.transferObjects(
    [adminCap],
    transaction.pure.address(senderAddress)
  )

  return transaction
}

export const buildUpdateConfigTransaction = ({
  packageId,
  executor,
  adminCapId,
  baseSpreadBps,
  volatilityMultiplierBps,
  orderExpirationTimeMs,
  maxPriceAgeSecs,
  maxConfRatioBps,
  outerBalanceBps,
  inventorySkewBps
}: {
  packageId: string
  executor: WrappedSuiSharedObject
  adminCapId: string
  baseSpreadBps: bigint | number
  volatilityMultiplierBps: bigint | number
  orderExpirationTimeMs: bigint | number
  maxPriceAgeSecs: bigint | number
  maxConfRatioBps: bigint | number
  outerBalanceBps: bigint | number
  inventorySkewBps: bigint | number
}) => {
  const transaction = newTransaction()

  const ammConfig = transaction.moveCall({
    target: `${packageId}::config::new`,
    arguments: [
      transaction.pure.u64(baseSpreadBps),
      transaction.pure.u64(volatilityMultiplierBps),
      transaction.pure.u64(orderExpirationTimeMs),
      transaction.pure.u64(maxPriceAgeSecs),
      transaction.pure.u64(maxConfRatioBps),
      transaction.pure.u64(outerBalanceBps),
      transaction.pure.u64(inventorySkewBps)
    ]
  })

  transaction.moveCall({
    target: `${packageId}::executor::update_config`,
    arguments: [
      transaction.sharedObjectRef(executor.sharedRef),
      transaction.object(adminCapId),
      ammConfig
    ]
  })

  return transaction
}

/**
 * Builds a transaction that replaces the market maker's `Market` (pool + Pyth feed ids + cached
 * decimals). The on-chain `executor::update_market` call requires the market maker to be paused,
 * so the caller is responsible for pausing before signing and unpausing afterwards.
 */
export const buildUpdateMarketTransaction = ({
  packageId,
  executor,
  adminCapId,
  pool,
  baseCurrency,
  quoteCurrency,
  baseAssetTypeTag,
  quoteAssetTypeTag,
  basePythPriceFeedIdBytes,
  quotePythPriceFeedIdBytes
}: {
  packageId: string
  executor: WrappedSuiSharedObject
  adminCapId: string
  pool: WrappedSuiSharedObject
  baseCurrency: WrappedSuiSharedObject
  quoteCurrency: WrappedSuiSharedObject
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
  basePythPriceFeedIdBytes: number[]
  quotePythPriceFeedIdBytes: number[]
}) => {
  const validatedBasePythPriceFeedIdBytes = assertByteArrayLength(
    basePythPriceFeedIdBytes,
    PYTH_PRICE_FEED_ID_BYTES,
    "basePythPriceFeedIdBytes"
  )
  const validatedQuotePythPriceFeedIdBytes = assertByteArrayLength(
    quotePythPriceFeedIdBytes,
    PYTH_PRICE_FEED_ID_BYTES,
    "quotePythPriceFeedIdBytes"
  )
  const transaction = newTransaction()

  const market = transaction.moveCall({
    target: `${packageId}::market::new`,
    typeArguments: [baseAssetTypeTag, quoteAssetTypeTag],
    arguments: [
      transaction.sharedObjectRef(pool.sharedRef),
      transaction.sharedObjectRef(baseCurrency.sharedRef),
      transaction.sharedObjectRef(quoteCurrency.sharedRef),
      transaction.pure.vector("u8", validatedBasePythPriceFeedIdBytes),
      transaction.pure.vector("u8", validatedQuotePythPriceFeedIdBytes)
    ]
  })

  transaction.moveCall({
    target: `${packageId}::executor::update_market`,
    arguments: [
      transaction.sharedObjectRef(executor.sharedRef),
      transaction.object(adminCapId),
      market
    ]
  })

  return transaction
}

/**
 * Builds an atomic transaction that replaces the market maker's `Market` and preserves its
 * active/paused state around the `executor::update_market` call (which itself requires the
 * market maker to be paused).
 *
 * If `currentActive` is true, the PTB emits:
 *   `executor::pause` (using `currentPool`) → `market::new` → `executor::update_market` →
 *   `executor::unpause`
 *
 * Otherwise (market maker already paused), the PTB only emits `market::new` +
 * `executor::update_market`, leaving the market maker paused.
 *
 * The new `Market` is built from `pool` + `baseCurrency` + `quoteCurrency`; the type tags
 * (used for the `pause` call's type arguments) must match `pool`'s parameterization.
 */
export const buildUpdateMarketWithPauseTransaction = ({
  packageId,
  executor,
  adminCapId,
  currentActive,
  currentPool,
  pool,
  baseCurrency,
  quoteCurrency,
  baseAssetTypeTag,
  quoteAssetTypeTag,
  basePythPriceFeedIdBytes,
  quotePythPriceFeedIdBytes
}: {
  packageId: string
  executor: WrappedSuiSharedObject
  adminCapId: string
  currentActive: boolean
  currentPool: WrappedSuiSharedObject
  pool: WrappedSuiSharedObject
  baseCurrency: WrappedSuiSharedObject
  quoteCurrency: WrappedSuiSharedObject
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
  basePythPriceFeedIdBytes: number[]
  quotePythPriceFeedIdBytes: number[]
}) => {
  const validatedBasePythPriceFeedIdBytes = assertByteArrayLength(
    basePythPriceFeedIdBytes,
    PYTH_PRICE_FEED_ID_BYTES,
    "basePythPriceFeedIdBytes"
  )
  const validatedQuotePythPriceFeedIdBytes = assertByteArrayLength(
    quotePythPriceFeedIdBytes,
    PYTH_PRICE_FEED_ID_BYTES,
    "quotePythPriceFeedIdBytes"
  )
  const transaction = newTransaction()

  if (currentActive) {
    transaction.moveCall({
      target: `${packageId}::executor::pause`,
      typeArguments: [baseAssetTypeTag, quoteAssetTypeTag],
      arguments: [
        transaction.sharedObjectRef(executor.sharedRef),
        transaction.object(adminCapId),
        transaction.sharedObjectRef(currentPool.sharedRef),
        transaction.object(SUI_CLOCK_ID)
      ]
    })
  }

  const market = transaction.moveCall({
    target: `${packageId}::market::new`,
    typeArguments: [baseAssetTypeTag, quoteAssetTypeTag],
    arguments: [
      transaction.sharedObjectRef(pool.sharedRef),
      transaction.sharedObjectRef(baseCurrency.sharedRef),
      transaction.sharedObjectRef(quoteCurrency.sharedRef),
      transaction.pure.vector("u8", validatedBasePythPriceFeedIdBytes),
      transaction.pure.vector("u8", validatedQuotePythPriceFeedIdBytes)
    ]
  })

  transaction.moveCall({
    target: `${packageId}::executor::update_market`,
    arguments: [
      transaction.sharedObjectRef(executor.sharedRef),
      transaction.object(adminCapId),
      market
    ]
  })

  if (currentActive) {
    transaction.moveCall({
      target: `${packageId}::executor::unpause`,
      arguments: [
        transaction.sharedObjectRef(executor.sharedRef),
        transaction.object(adminCapId)
      ]
    })
  }

  return transaction
}

/**
 * Builds a pause transaction for a market maker executor. Cancels all open
 * orders and settles the BalanceManager. Requires the executor to be active.
 */
export const buildPauseTransaction = ({
  packageId,
  executor,
  adminCapId,
  pool,
  baseAssetTypeTag,
  quoteAssetTypeTag
}: {
  packageId: string
  executor: WrappedSuiSharedObject
  adminCapId: string
  pool: WrappedSuiSharedObject
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${packageId}::executor::pause`,
    typeArguments: [baseAssetTypeTag, quoteAssetTypeTag],
    arguments: [
      transaction.sharedObjectRef(executor.sharedRef),
      transaction.object(adminCapId),
      transaction.sharedObjectRef(pool.sharedRef),
      transaction.object(SUI_CLOCK_ID)
    ]
  })

  return transaction
}

/**
 * Builds an unpause transaction for a market maker executor. Requires the
 * executor to be paused; flips `active` back to true so the next
 * `refresh_quotes` call is allowed.
 */
export const buildUnpauseTransaction = ({
  packageId,
  executor,
  adminCapId
}: {
  packageId: string
  executor: WrappedSuiSharedObject
  adminCapId: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${packageId}::executor::unpause`,
    arguments: [
      transaction.sharedObjectRef(executor.sharedRef),
      transaction.object(adminCapId)
    ]
  })

  return transaction
}

/**
 * Builds a deposit transaction for a market maker executor. Splits the
 * requested `amount` from the provided source coin (or from the gas coin when
 * `sourceCoinId` is omitted — valid only for SUI deposits) and hands the
 * resulting coin to `executor::deposit<T>`.
 */
export const buildDepositTransaction = ({
  packageId,
  executor,
  adminCapId,
  coinTypeTag,
  amount,
  sourceCoinId
}: {
  packageId: string
  executor: WrappedSuiSharedObject
  adminCapId: string
  coinTypeTag: string
  amount: bigint | number
  /**
   * Object ID of the Coin<T> to split from. Omit for SUI deposits to split
   * from the gas coin.
   */
  sourceCoinId?: string
}) => {
  const transaction = newTransaction()

  const source = sourceCoinId
    ? transaction.object(sourceCoinId)
    : transaction.gas
  const [depositCoin] = transaction.splitCoins(source, [
    transaction.pure.u64(amount)
  ])

  transaction.moveCall({
    target: `${packageId}::executor::deposit`,
    typeArguments: [coinTypeTag],
    arguments: [
      transaction.sharedObjectRef(executor.sharedRef),
      transaction.object(adminCapId),
      depositCoin
    ]
  })

  return transaction
}

/**
 * Builds a withdraw transaction that wraps `executor::withdraw<T>` with an
 * optional pause/unpause envelope. The on-chain withdraw requires the executor
 * to be paused; when `currentActive` is true the PTB emits:
 *
 *   `pause(<Base, Quote>, executor, cap, pool, clock)` →
 *   `withdraw<T>(executor, cap, amount)` → `transfer(withdrawn, sender)` →
 *   `unpause(executor, cap)`
 *
 * Otherwise (already paused) only withdraw + transfer are emitted, leaving the
 * executor paused.
 */
export const buildWithdrawWithPauseTransaction = ({
  packageId,
  executor,
  adminCapId,
  coinTypeTag,
  amount,
  recipientAddress,
  currentActive,
  pool,
  baseAssetTypeTag,
  quoteAssetTypeTag
}: {
  packageId: string
  executor: WrappedSuiSharedObject
  adminCapId: string
  coinTypeTag: string
  amount: bigint | number
  recipientAddress: string
  currentActive: boolean
  pool: WrappedSuiSharedObject
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
}) => {
  const transaction = newTransaction()

  if (currentActive) {
    transaction.moveCall({
      target: `${packageId}::executor::pause`,
      typeArguments: [baseAssetTypeTag, quoteAssetTypeTag],
      arguments: [
        transaction.sharedObjectRef(executor.sharedRef),
        transaction.object(adminCapId),
        transaction.sharedObjectRef(pool.sharedRef),
        transaction.object(SUI_CLOCK_ID)
      ]
    })
  }

  const [withdrawnCoin] = transaction.moveCall({
    target: `${packageId}::executor::withdraw`,
    typeArguments: [coinTypeTag],
    arguments: [
      transaction.sharedObjectRef(executor.sharedRef),
      transaction.object(adminCapId),
      transaction.pure.u64(amount)
    ]
  })

  transaction.transferObjects(
    [withdrawnCoin],
    transaction.pure.address(recipientAddress)
  )

  if (currentActive) {
    transaction.moveCall({
      target: `${packageId}::executor::unpause`,
      arguments: [
        transaction.sharedObjectRef(executor.sharedRef),
        transaction.object(adminCapId)
      ]
    })
  }

  return transaction
}
