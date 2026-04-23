import type { SuiClient, SuiObjectData } from "@mysten/sui/client"

import {
  getSuiObject,
  unwrapMoveObjectFields
} from "@sui-amm/tooling-core/object"
import {
  formatOptionalNumericValue,
  formatVectorBytesAsHex
} from "@sui-amm/tooling-core/utils/formatters"
import {
  parseNonNegativeU64,
  parsePositiveU64
} from "@sui-amm/tooling-core/utils/utility"
import { parsePythPriceFeedIdBytes } from "../ptb/amm.ts"

export const AMM_ADMIN_CAP_TYPE_SUFFIX = "::executor::AdminCap"
export const PROP_AMM_EXECUTOR_SUFFIX = "::executor::PropAmmApp"

export const MAX_BASE_SPREAD_BPS = "10000"

export const DEFAULT_ORDER_EXPIRATION_TIME_MS = "86400000"
export const DEFAULT_MAX_PRICE_AGE_SECS = "60"
export const DEFAULT_MAX_CONF_RATIO_BPS = "1000"

export type AmmConfigOverview = {
  configId: string
  baseSpreadBps: string
  volatilitySpreadBps: string
  active: boolean
  basePythPriceFeedIdHex: string
  quotePythPriceFeedIdHex: string
  poolId: string
  orderExpirationTimeMs: string
  maxPriceAgeSecs: string
  maxConfRatioBps: string
}

type AmmConfigFields = {
  base_spread_bps?: unknown
  volatility_spread_bps?: unknown
  order_expiration_time_ms?: unknown
  max_price_age_secs?: unknown
  max_conf_ratio_bps?: unknown
}

type MarketFields = {
  pool_id?: unknown
  base_pyth_price_feed_id?: unknown
  quote_pyth_price_feed_id?: unknown
  base_price_publish_time?: unknown
  quote_price_publish_time?: unknown
}

type ExecutorFields = {
  active?: unknown
  config?: { fields?: AmmConfigFields } | AmmConfigFields
  market?: { fields?: MarketFields } | MarketFields
}

const unwrapNestedFields = <T>(value: unknown): T | undefined => {
  if (!value || typeof value !== "object") return undefined
  if ("fields" in value) return (value as { fields: T }).fields
  return value as T
}

const requireNumericField = (value: unknown, label: string): string => {
  const formatted = formatOptionalNumericValue(value)
  if (formatted === undefined) throw new Error(`${label} is required.`)
  return formatted
}

const requireBooleanField = (value: unknown, label: string): boolean => {
  if (typeof value === "boolean") return value
  throw new Error(`${label} is required.`)
}

const requireFeedIdHex = (value: unknown, label: string): string => {
  const formatted = formatVectorBytesAsHex(value)
  if (formatted === "Unknown") {
    throw new Error(`${label} is required.`)
  }
  return formatted
}

const requireStringField = (value: unknown, label: string): string => {
  if (typeof value === "string") return value
  throw new Error(`${label} is required.`)
}

const buildAmmConfigOverviewFromObject = ({
  configId,
  object
}: {
  configId: string
  object: SuiObjectData
}): AmmConfigOverview => {
  const executorFields = unwrapMoveObjectFields<ExecutorFields>(object)
  const config =
    unwrapNestedFields<AmmConfigFields>(executorFields.config) ?? {}
  const market =
    unwrapNestedFields<MarketFields>(executorFields.market) ?? {}

  return {
    configId,
    baseSpreadBps: requireNumericField(
      config.base_spread_bps,
      "Base spread bps"
    ),
    volatilitySpreadBps: requireNumericField(
      config.volatility_spread_bps,
      "Volatility spread bps"
    ),
    active: requireBooleanField(executorFields.active, "Active"),
    basePythPriceFeedIdHex: requireFeedIdHex(
      market.base_pyth_price_feed_id,
      "Base Pyth price feed id"
    ),
    quotePythPriceFeedIdHex: requireFeedIdHex(
      market.quote_pyth_price_feed_id,
      "Quote Pyth price feed id"
    ),
    poolId: requireStringField(market.pool_id, "Pool id"),
    orderExpirationTimeMs: requireNumericField(
      config.order_expiration_time_ms,
      "Order expiration time ms"
    ),
    maxPriceAgeSecs: requireNumericField(
      config.max_price_age_secs,
      "Max price age secs"
    ),
    maxConfRatioBps: requireNumericField(
      config.max_conf_ratio_bps,
      "Max conf ratio bps"
    )
  }
}

export const getAmmConfigOverview = async (
  configId: string,
  suiClient: SuiClient
): Promise<AmmConfigOverview> => {
  const { object } = await getSuiObject(
    { objectId: configId, options: { showContent: true, showType: true } },
    { suiClient }
  )

  return buildAmmConfigOverviewFromObject({ configId, object })
}

export const DEFAULT_BASE_SPREAD_BPS = "25"
export const DEFAULT_VOLATILITY_SPREAD_BPS = "200"

const resolveBaseSpreadBps = (rawValue?: string): bigint => {
  const baseSpreadBps = parsePositiveU64(
    rawValue ?? DEFAULT_BASE_SPREAD_BPS,
    "Base spread bps"
  )

  if (baseSpreadBps > BigInt(MAX_BASE_SPREAD_BPS)) {
    throw new Error(`Base spread bps must be at most ${MAX_BASE_SPREAD_BPS}.`)
  }

  return baseSpreadBps
}

const resolveVolatilitySpreadBps = (rawValue?: string): bigint =>
  parseNonNegativeU64(
    rawValue ?? DEFAULT_VOLATILITY_SPREAD_BPS,
    "Volatility spread bps"
  )

export const resolveAmmConfigInputs = ({
  volatilitySpreadBps,
  baseSpreadBps,
  basePythPriceFeedIdHex,
  quotePythPriceFeedIdHex,
  orderExpirationTimeMs,
  maxPriceAgeSecs,
  maxConfRatioBps
}: {
  volatilitySpreadBps?: string
  baseSpreadBps?: string
  basePythPriceFeedIdHex: string
  quotePythPriceFeedIdHex: string
  orderExpirationTimeMs?: string
  maxPriceAgeSecs?: string
  maxConfRatioBps?: string
}): {
  baseSpreadBps: bigint
  volatilitySpreadBps: bigint
  basePythPriceFeedIdHex: string
  basePythPriceFeedIdBytes: number[]
  quotePythPriceFeedIdHex: string
  quotePythPriceFeedIdBytes: number[]
  orderExpirationTimeMs: bigint
  maxPriceAgeSecs: bigint
  maxConfRatioBps: bigint
} => ({
  baseSpreadBps: resolveBaseSpreadBps(baseSpreadBps),
  volatilitySpreadBps: resolveVolatilitySpreadBps(volatilitySpreadBps),
  basePythPriceFeedIdHex,
  basePythPriceFeedIdBytes: parsePythPriceFeedIdBytes(basePythPriceFeedIdHex),
  quotePythPriceFeedIdHex,
  quotePythPriceFeedIdBytes: parsePythPriceFeedIdBytes(quotePythPriceFeedIdHex),
  orderExpirationTimeMs: parseNonNegativeU64(
    orderExpirationTimeMs ?? DEFAULT_ORDER_EXPIRATION_TIME_MS,
    "Order expiration time ms"
  ),
  maxPriceAgeSecs: parseNonNegativeU64(
    maxPriceAgeSecs ?? DEFAULT_MAX_PRICE_AGE_SECS,
    "Max price age secs"
  ),
  maxConfRatioBps: parsePositiveU64(
    maxConfRatioBps ?? DEFAULT_MAX_CONF_RATIO_BPS,
    "Max conf ratio bps"
  )
})
