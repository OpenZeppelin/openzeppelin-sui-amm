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

  const ammConfig = transaction.moveCall({
    target: `${packageId}::config::new`,
    arguments: [
      transaction.pure.address(poolId),
      transaction.pure.u64(baseSpreadBps),
      transaction.pure.u64(volatilitySpreadBps),
      transaction.pure.vector("u8", validatedBasePythPriceFeedIdBytes),
      transaction.pure.vector("u8", validatedQuotePythPriceFeedIdBytes),
      transaction.pure.u64(orderExpirationTimeMs),
      transaction.pure.u64(maxPriceAgeSecs),
      transaction.pure.u64(maxConfRatioBps)
    ]
  })

  const [marketMaker, adminCap] = transaction.moveCall({
    target: `${packageId}::executor::create`,
    arguments: [ammConfig]
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

export const buildUpdateMarketMakerTransaction = ({
  packageId,
  marketMaker,
  adminCapId,
  poolId,
  baseSpreadBps,
  volatilitySpreadBps,
  basePythPriceFeedIdBytes,
  quotePythPriceFeedIdBytes,
  orderExpirationTimeMs,
  maxPriceAgeSecs,
  maxConfRatioBps
}: {
  packageId: string
  marketMaker: WrappedSuiSharedObject
  adminCapId: string
  poolId: string
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

  const ammConfig = transaction.moveCall({
    target: `${packageId}::config::new`,
    arguments: [
      transaction.pure.address(poolId),
      transaction.pure.u64(baseSpreadBps),
      transaction.pure.u64(volatilitySpreadBps),
      transaction.pure.vector("u8", validatedBasePythPriceFeedIdBytes),
      transaction.pure.vector("u8", validatedQuotePythPriceFeedIdBytes),
      transaction.pure.u64(orderExpirationTimeMs),
      transaction.pure.u64(maxPriceAgeSecs),
      transaction.pure.u64(maxConfRatioBps)
    ]
  })

  transaction.moveCall({
    target: `${packageId}::executor::update_market_maker`,
    arguments: [
      transaction.sharedObjectRef(marketMaker.sharedRef),
      transaction.object(adminCapId),
      ammConfig
    ]
  })

  return transaction
}
