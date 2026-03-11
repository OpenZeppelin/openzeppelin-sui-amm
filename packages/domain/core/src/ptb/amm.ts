import { assertBytesLength, hexToBytes } from "@sui-amm/tooling-core/hex"
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

export const buildCreateAmmConfigTransaction = ({
  packageId,
  adminCapId,
  baseSpreadBps,
  volatilityMultiplierBps,
  useLaser,
  pythPriceFeedIdBytes
}: {
  packageId: string
  adminCapId: string
  baseSpreadBps: bigint | number
  volatilityMultiplierBps: bigint | number
  useLaser: boolean
  pythPriceFeedIdBytes: number[]
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${packageId}::manager::create_amm_config_and_share`,
    arguments: [
      transaction.object(adminCapId),
      transaction.pure.u64(baseSpreadBps),
      transaction.pure.u64(volatilityMultiplierBps),
      transaction.pure.bool(useLaser),
      transaction.pure.vector("u8", pythPriceFeedIdBytes)
    ]
  })

  return transaction
}

export const buildUpdateAmmConfigTransaction = ({
  packageId,
  adminCapId,
  config,
  baseSpreadBps,
  volatilityMultiplierBps,
  useLaser,
  tradingPaused,
  pythPriceFeedIdBytes
}: {
  packageId: string
  adminCapId: string
  config: WrappedSuiSharedObject
  baseSpreadBps: bigint | number
  volatilityMultiplierBps: bigint | number
  useLaser: boolean
  tradingPaused: boolean
  pythPriceFeedIdBytes: number[]
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${packageId}::manager::update_amm_config_and_emit`,
    arguments: [
      transaction.sharedObjectRef(config.sharedRef),
      transaction.object(adminCapId),
      transaction.pure.u64(baseSpreadBps),
      transaction.pure.u64(volatilityMultiplierBps),
      transaction.pure.bool(useLaser),
      transaction.pure.bool(tradingPaused),
      transaction.pure.vector("u8", pythPriceFeedIdBytes)
    ]
  })

  return transaction
}
