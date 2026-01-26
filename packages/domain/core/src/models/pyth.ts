import type { Transaction, TransactionArgument } from "@mysten/sui/transactions"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import { SUI_CLOCK_ID } from "@sui-amm/tooling-core/constants"
import {
  assertBytesLength,
  hexToBytes,
  normalizeHex
} from "@sui-amm/tooling-core/hex"

export type MockPriceFeedConfig = {
  feedIdHex: string
  price: bigint
  confidence: bigint
  exponent: number
}

export type LabeledMockPriceFeedConfig = MockPriceFeedConfig & {
  label: string
}

export const DEFAULT_MOCK_PRICE_FEED: LabeledMockPriceFeedConfig = {
  label: "MOCK_SUI_FEED",
  feedIdHex:
    "0x202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
  // Approx SUI/USD. $1.84 with exponent -2.
  price: 184n,
  confidence: 2n,
  exponent: -2
}

type MockFeedMatcher = {
  feedIdHex?: string
  label?: string
}

export const isMatchingMockPriceFeedConfig = (
  config: LabeledMockPriceFeedConfig,
  candidate: MockFeedMatcher
) => {
  const feedIdMatch = candidate.feedIdHex
    ? normalizeHex(candidate.feedIdHex) === normalizeHex(config.feedIdHex)
    : false

  const labelMatch = candidate.label ? candidate.label === config.label : false

  return feedIdMatch || labelMatch
}

export const findMockPriceFeedConfig = (
  candidate: MockFeedMatcher,
  configs: LabeledMockPriceFeedConfig[] = [DEFAULT_MOCK_PRICE_FEED]
) => configs.find((config) => isMatchingMockPriceFeedConfig(config, candidate))

const PYTH_PRICE_INFO_TYPE = "price_info::PriceInfoObject"

export const getPythPriceInfoType = (pythPackageId: string) =>
  `${normalizeSuiObjectId(pythPackageId)}::${PYTH_PRICE_INFO_TYPE}`

export const deriveMockPriceComponents = (config: MockPriceFeedConfig) => {
  const priceMagnitude = config.price >= 0n ? config.price : -config.price
  const priceIsNegative = config.price < 0n
  const exponentMagnitude =
    config.exponent >= 0 ? config.exponent : -config.exponent
  const exponentIsNegative = config.exponent < 0

  return {
    priceMagnitude,
    priceIsNegative,
    exponentMagnitude,
    exponentIsNegative
  }
}

export const publishMockPriceFeed = (
  transaction: Transaction,
  pythPackageId: string,
  config: MockPriceFeedConfig,
  clockObject?: TransactionArgument
) => {
  const feedIdBytes = assertBytesLength(hexToBytes(config.feedIdHex), 32)
  const {
    priceMagnitude,
    priceIsNegative,
    exponentMagnitude,
    exponentIsNegative
  } = deriveMockPriceComponents(config)

  return transaction.moveCall({
    target: `${pythPackageId}::price_info::publish_price_feed`,
    arguments: [
      // BCS-encode as vector<u8>; passing raw bytes would skip the length prefix and fail deserialization.
      transaction.pure.vector("u8", feedIdBytes),
      transaction.pure.u64(priceMagnitude),
      transaction.pure.bool(priceIsNegative),
      transaction.pure.u64(config.confidence),
      transaction.pure.u64(exponentMagnitude),
      transaction.pure.bool(exponentIsNegative),
      clockObject ?? transaction.object(SUI_CLOCK_ID)
    ]
  })
}
