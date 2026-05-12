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
  /// Last segment of the Move type tag for the asset this feed prices, e.g.
  /// `SUI` for `0x2::sui::SUI` and `USDC` for `<pkg>::mock_coin::USDC`. Used
  /// by `findMockPriceFeedByCoinType` so the create-executor form can derive
  /// feed-id-hex straight from the pool's base/quote coin types.
  assetSymbol: string
}

/// Real Pyth `SUI/USD` feed identifier (mainnet/testnet/Hermes), reused on
/// localnet so users can paste the same hex from
/// https://docs.pyth.network/price-feeds/core/price-feeds/price-feed-ids.
export const SUI_USD_FEED: LabeledMockPriceFeedConfig = {
  label: "SUI_USD",
  assetSymbol: "SUI",
  feedIdHex:
    "0x50c67b3fd225db8912a424dd4baed60ffdde625ed2feaaf283724f9608fea266",
  // Approx SUI/USD = $1.50 with exponent -2.
  price: 150n,
  confidence: 2n,
  exponent: -2
}

/// Real Pyth `USDC/USD` feed identifier — same hex on localnet so the UI
/// uses one feed-id-hex constant per asset across networks.
export const USDC_USD_FEED: LabeledMockPriceFeedConfig = {
  label: "USDC_USD",
  assetSymbol: "USDC",
  feedIdHex:
    "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722",
  // Approx USDC/USD = $1.00 with exponent -2.
  price: 100n,
  confidence: 1n,
  exponent: -2
}

/// All localnet mock price feeds. Mock setup publishes one PriceInfoObject
/// per entry so `SuiPythClient.getPriceFeedObjectId(feedId)` resolves both.
export const ALL_MOCK_PRICE_FEEDS: LabeledMockPriceFeedConfig[] = [
  SUI_USD_FEED,
  USDC_USD_FEED
]

/// Backwards-compatible alias.
export const DEFAULT_MOCK_PRICE_FEED: LabeledMockPriceFeedConfig = SUI_USD_FEED

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
    : true

  const labelMatch = candidate.label ? candidate.label === config.label : true

  return feedIdMatch && labelMatch
}

export const findMockPriceFeedConfig = (
  candidate: MockFeedMatcher,
  configs: LabeledMockPriceFeedConfig[] = ALL_MOCK_PRICE_FEEDS
) => configs.find((config) => isMatchingMockPriceFeedConfig(config, candidate))

/// Look up the mock feed for a Move coin type (e.g. `0x2::sui::SUI` →
/// `SUI_USD_FEED`). Matching is on the last `::` segment, case-sensitive.
export const findMockPriceFeedByCoinType = (
  coinType: string,
  configs: LabeledMockPriceFeedConfig[] = ALL_MOCK_PRICE_FEEDS
): LabeledMockPriceFeedConfig | undefined => {
  const symbol = coinType.split("::").pop()?.trim()
  if (!symbol) return undefined
  return configs.find((config) => config.assetSymbol === symbol)
}

const PYTH_PRICE_INFO_TYPE = "price_info::PriceInfoObject"

export const getPythPriceInfoType = (pythPackageId: string) =>
  `${normalizeSuiObjectId(pythPackageId)}::${PYTH_PRICE_INFO_TYPE}`

type PythI64Field = { magnitude: string | number; negative: boolean }
type PythPriceFields = {
  price: { fields: PythI64Field }
  conf: string | number
  expo: { fields: PythI64Field }
}

/**
 * Reads the current `magnitude / negative / conf / expo` from a fetched mock
 * Pyth `PriceInfoObject` so callers can re-stamp it without changing the
 * price (only the timestamp moves). Used by the UI's Refresh Quotes flow and
 * by the maintenance script to satisfy
 * `assert_price_age_within_limit` while preserving whatever the
 * market-activity bot has walked the feed to.
 *
 * Pass the parsed `content` Sui returns from `getObject({ showContent: true })`
 * (or any wrapper that exposes that content unmodified). Throws when the
 * caller forgot to ask for parsed Move content.
 */
export const readPythPriceComponentsFromContent = (
  content: { dataType?: string } | null | undefined
): MockPriceFeedComponents => {
  if (!content || content.dataType !== "moveObject") {
    throw new Error(
      "PriceInfoObject content missing parsed Move fields (caller needs `showContent: true`)."
    )
  }
  const fields = (
    content as unknown as {
      fields: {
        price_info: {
          fields: {
            price_feed: { fields: { price: { fields: PythPriceFields } } }
          }
        }
      }
    }
  ).fields
  const priceFields = fields.price_info.fields.price_feed.fields.price.fields
  return {
    priceMagnitude: BigInt(priceFields.price.fields.magnitude),
    priceIsNegative: Boolean(priceFields.price.fields.negative),
    confidence: BigInt(priceFields.conf),
    exponentMagnitude: BigInt(priceFields.expo.fields.magnitude),
    exponentIsNegative: Boolean(priceFields.expo.fields.negative)
  }
}

export type MockPriceFeedComponents = {
  priceMagnitude: bigint
  priceIsNegative: boolean
  confidence: bigint
  exponentMagnitude: bigint
  exponentIsNegative: boolean
}

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
  pythStateRef: TransactionArgument,
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
      pythStateRef,
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
