import { normalizeStructTag } from "@mysten/sui/utils"

import { SUI_CLOCK_ID, SUI_COIN_TYPE } from "@sui-amm/tooling-core/constants"
import {
  assertByteArrayLength,
  assertBytesLength,
  hexToBytes
} from "@sui-amm/tooling-core/hex"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { newTransaction } from "@sui-amm/tooling-core/transactions"
import { validateRequiredHexBytes } from "@sui-amm/tooling-core/utils/validation"

const NORMALIZED_SUI_COIN_TYPE = normalizeStructTag(SUI_COIN_TYPE)

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
  inventorySkewBps,
  postOnly
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
  /**
   * When true, `refresh_quotes` places each order with DeepBook's `post_only` flag —
   * any order that would cross the resting book aborts the whole refresh and the
   * previous quotes survive until the next oracle reading. When false, the crossing
   * portion executes immediately as a taker (legacy `no_restriction` behavior).
   */
  postOnly: boolean
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
      transaction.pure.u64(inventorySkewBps),
      transaction.pure.bool(postOnly)
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
  inventorySkewBps,
  postOnly
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
  /**
   * When true, `refresh_quotes` places each order with DeepBook's `post_only` flag —
   * any order that would cross the resting book aborts the whole refresh and the
   * previous quotes survive until the next oracle reading. When false, the crossing
   * portion executes immediately as a taker (legacy `no_restriction` behavior).
   */
  postOnly: boolean
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
      transaction.pure.u64(inventorySkewBps),
      transaction.pure.bool(postOnly)
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

export type MockPriceComponents = {
  priceMagnitude: bigint | number
  priceIsNegative: boolean
  confidence: bigint | number
  exponentMagnitude: bigint | number
  exponentIsNegative: boolean
}

const appendMockPriceFeedUpdate = (
  transaction: ReturnType<typeof newTransaction>,
  {
    pythMockPackageId,
    priceInfoObject,
    components
  }: {
    pythMockPackageId: string
    priceInfoObject: WrappedSuiSharedObject
    components: MockPriceComponents
  }
) => {
  transaction.moveCall({
    target: `${pythMockPackageId}::price_info::update_price_feed`,
    arguments: [
      transaction.sharedObjectRef(priceInfoObject.sharedRef),
      transaction.pure.u64(components.priceMagnitude),
      transaction.pure.bool(components.priceIsNegative),
      transaction.pure.u64(components.confidence),
      transaction.pure.u64(components.exponentMagnitude),
      transaction.pure.bool(components.exponentIsNegative),
      transaction.object(SUI_CLOCK_ID)
    ]
  })
}

/**
 * Builds a localnet-only `refresh_quotes_permissionless` transaction. Stamps
 * each `PriceInfoObject` with the SAME magnitude/expo it already holds so the
 * `assert_price_age_within_limit` check passes (we just refresh the
 * `timestamp` to the current chain clock) — that way the market-activity bot's
 * walked price is preserved instead of clobbered by hardcoded defaults.
 * Callers must read the current on-chain values and pass them in unchanged.
 */
export const buildLocalnetRefreshQuotesTransaction = ({
  packageId,
  executor,
  pool,
  baseAssetTypeTag,
  quoteAssetTypeTag,
  pythMockPackageId,
  basePriceInfoObject,
  quotePriceInfoObject,
  basePriceComponents,
  quotePriceComponents
}: {
  packageId: string
  executor: WrappedSuiSharedObject
  pool: WrappedSuiSharedObject
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
  pythMockPackageId: string
  basePriceInfoObject: WrappedSuiSharedObject
  quotePriceInfoObject: WrappedSuiSharedObject
  basePriceComponents: MockPriceComponents
  quotePriceComponents: MockPriceComponents
}) => {
  const transaction = newTransaction()

  appendMockPriceFeedUpdate(transaction, {
    pythMockPackageId,
    priceInfoObject: basePriceInfoObject,
    components: basePriceComponents
  })

  // Skip the second stamp when both feeds map to the same object — Sui
  // forbids two `&mut` references to the same shared object in a single PTB.
  if (
    basePriceInfoObject.sharedRef.objectId !==
    quotePriceInfoObject.sharedRef.objectId
  ) {
    appendMockPriceFeedUpdate(transaction, {
      pythMockPackageId,
      priceInfoObject: quotePriceInfoObject,
      components: quotePriceComponents
    })
  }

  transaction.moveCall({
    target: `${packageId}::executor::refresh_quotes_permissionless`,
    typeArguments: [baseAssetTypeTag, quoteAssetTypeTag],
    arguments: [
      transaction.sharedObjectRef(executor.sharedRef),
      transaction.sharedObjectRef(pool.sharedRef),
      transaction.sharedObjectRef(basePriceInfoObject.sharedRef),
      transaction.sharedObjectRef(quotePriceInfoObject.sharedRef),
      transaction.object(SUI_CLOCK_ID)
    ]
  })

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
 * `refresh_quotes_permissionless` call is allowed.
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
  if (
    !sourceCoinId &&
    normalizeStructTag(coinTypeTag) !== NORMALIZED_SUI_COIN_TYPE
  ) {
    throw new Error(
      `buildDepositTransaction: sourceCoinId is required for non-SUI deposits (got coinTypeTag=${coinTypeTag}). The gas-coin fallback only applies to ${SUI_COIN_TYPE}.`
    )
  }

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
 * Builds a withdraw transaction that wraps `executor::withdraw<T>` (or
 * `executor::withdraw_all<T>` when `amount` is omitted) with an optional
 * pause/unpause envelope. The on-chain withdraw requires the executor to be
 * paused; when `currentActive` is true the PTB emits:
 *
 *   `pause(<Base, Quote>, executor, cap, pool, clock)` →
 *   `withdraw[_all]<T>(executor, cap[, amount])` →
 *   `transfer(withdrawn, sender)` →
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
  /** Withdraw amount in atoms. Omit to call `withdraw_all<T>` instead, which drains the BalanceManager's full balance for `T`. */
  amount?: bigint | number
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

  const [withdrawnCoin] =
    amount === undefined
      ? transaction.moveCall({
          target: `${packageId}::executor::withdraw_all`,
          typeArguments: [coinTypeTag],
          arguments: [
            transaction.sharedObjectRef(executor.sharedRef),
            transaction.object(adminCapId)
          ]
        })
      : transaction.moveCall({
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
