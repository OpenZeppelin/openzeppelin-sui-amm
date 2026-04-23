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

export const buildCreateMarketMakerTransaction = ({
  packageId,
  poolId,
  senderAddress,
  baseSpreadBps,
  volatilitySpreadBps,
  basePythPriceFeedIdBytes,
  quotePythPriceFeedIdBytes,
  orderExpirationTimeMs,
  maxPriceAgeSecs,
  maxConfRatioBps
}: {
  packageId: string
  poolId: string
  senderAddress: string
  baseSpreadBps: bigint | number
  volatilitySpreadBps: bigint | number
  basePythPriceFeedIdBytes: number[]
  quotePythPriceFeedIdBytes: number[]
  orderExpirationTimeMs: bigint | number
  maxPriceAgeSecs: bigint | number
  maxConfRatioBps: bigint | number
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
    arguments: [
      transaction.pure.address(poolId),
      transaction.pure.vector("u8", validatedBasePythPriceFeedIdBytes),
      transaction.pure.vector("u8", validatedQuotePythPriceFeedIdBytes)
    ]
  })

  const ammConfig = transaction.moveCall({
    target: `${packageId}::config::new`,
    arguments: [
      transaction.pure.u64(baseSpreadBps),
      transaction.pure.u64(volatilitySpreadBps),
      transaction.pure.u64(orderExpirationTimeMs),
      transaction.pure.u64(maxPriceAgeSecs),
      transaction.pure.u64(maxConfRatioBps)
    ]
  })

  const [marketMaker, adminCap] = transaction.moveCall({
    target: `${packageId}::executor::create`,
    arguments: [market, ammConfig]
  })

  transaction.moveCall({
    target: "0x2::transfer::public_share_object",
    typeArguments: [`${packageId}::executor::MarketMaker`],
    arguments: [marketMaker]
  })

  transaction.transferObjects(
    [adminCap],
    transaction.pure.address(senderAddress)
  )

  return transaction
}

export const buildUpdateConfigTransaction = ({
  packageId,
  marketMaker,
  adminCapId,
  baseSpreadBps,
  volatilitySpreadBps,
  orderExpirationTimeMs,
  maxPriceAgeSecs,
  maxConfRatioBps
}: {
  packageId: string
  marketMaker: WrappedSuiSharedObject
  adminCapId: string
  baseSpreadBps: bigint | number
  volatilitySpreadBps: bigint | number
  orderExpirationTimeMs: bigint | number
  maxPriceAgeSecs: bigint | number
  maxConfRatioBps: bigint | number
}) => {
  const transaction = newTransaction()

  const ammConfig = transaction.moveCall({
    target: `${packageId}::config::new`,
    arguments: [
      transaction.pure.u64(baseSpreadBps),
      transaction.pure.u64(volatilitySpreadBps),
      transaction.pure.u64(orderExpirationTimeMs),
      transaction.pure.u64(maxPriceAgeSecs),
      transaction.pure.u64(maxConfRatioBps)
    ]
  })

  transaction.moveCall({
    target: `${packageId}::executor::update_config`,
    arguments: [
      transaction.sharedObjectRef(marketMaker.sharedRef),
      transaction.object(adminCapId),
      ammConfig
    ]
  })

  return transaction
}

/**
 * Builds a transaction that replaces the market maker's `Market` (pool id and Pyth feed ids).
 * The on-chain `executor::update_market` call requires the market maker to be paused, so the
 * caller is responsible for pausing before signing and unpausing afterwards.
 */
export const buildUpdateMarketTransaction = ({
  packageId,
  marketMaker,
  adminCapId,
  poolId,
  basePythPriceFeedIdBytes,
  quotePythPriceFeedIdBytes
}: {
  packageId: string
  marketMaker: WrappedSuiSharedObject
  adminCapId: string
  poolId: string
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
    arguments: [
      transaction.pure.address(poolId),
      transaction.pure.vector("u8", validatedBasePythPriceFeedIdBytes),
      transaction.pure.vector("u8", validatedQuotePythPriceFeedIdBytes)
    ]
  })

  transaction.moveCall({
    target: `${packageId}::executor::update_market`,
    arguments: [
      transaction.sharedObjectRef(marketMaker.sharedRef),
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
 */
export const buildUpdateMarketWithPauseTransaction = ({
  packageId,
  marketMaker,
  adminCapId,
  currentActive,
  currentPool,
  baseAssetTypeTag,
  quoteAssetTypeTag,
  newPoolId,
  basePythPriceFeedIdBytes,
  quotePythPriceFeedIdBytes
}: {
  packageId: string
  marketMaker: WrappedSuiSharedObject
  adminCapId: string
  currentActive: boolean
  currentPool: WrappedSuiSharedObject
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
  newPoolId: string
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
        transaction.sharedObjectRef(marketMaker.sharedRef),
        transaction.object(adminCapId),
        transaction.sharedObjectRef(currentPool.sharedRef),
        transaction.object(SUI_CLOCK_ID)
      ]
    })
  }

  const market = transaction.moveCall({
    target: `${packageId}::market::new`,
    arguments: [
      transaction.pure.address(newPoolId),
      transaction.pure.vector("u8", validatedBasePythPriceFeedIdBytes),
      transaction.pure.vector("u8", validatedQuotePythPriceFeedIdBytes)
    ]
  })

  transaction.moveCall({
    target: `${packageId}::executor::update_market`,
    arguments: [
      transaction.sharedObjectRef(marketMaker.sharedRef),
      transaction.object(adminCapId),
      market
    ]
  })

  if (currentActive) {
    transaction.moveCall({
      target: `${packageId}::executor::unpause`,
      arguments: [
        transaction.sharedObjectRef(marketMaker.sharedRef),
        transaction.object(adminCapId)
      ]
    })
  }

  return transaction
}
