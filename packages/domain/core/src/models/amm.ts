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
export const DEFAULT_OUTER_BALANCE_BPS = "5000"
export const DEFAULT_INVENTORY_SKEW_BPS = "0"

export type AmmConfigOverview = {
  configId: string
  baseSpreadBps: string
  volatilityMultiplierBps: string
  active: boolean
  basePythPriceFeedIdHex: string
  quotePythPriceFeedIdHex: string
  poolId: string
  orderExpirationTimeMs: string
  maxPriceAgeSecs: string
  maxConfRatioBps: string
  outerBalanceBps: string
  inventorySkewBps: string
}

type AmmConfigFields = {
  base_spread_bps?: unknown
  volatility_multiplier_bps?: unknown
  order_expiration_time_ms?: unknown
  max_price_age_secs?: unknown
  max_conf_ratio_bps?: unknown
  outer_balance_bps?: unknown
  inventory_skew_bps?: unknown
}

type MarketFields = {
  pool_id?: unknown
  base?: unknown
  quote?: unknown
}

type MarketCurrencyFields = {
  pyth_price_feed_id?: unknown
  price_publish_time?: unknown
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
  const baseCurrency =
    unwrapNestedFields<MarketCurrencyFields>(market.base) ?? {}
  const quoteCurrency =
    unwrapNestedFields<MarketCurrencyFields>(market.quote) ?? {}

  return {
    configId,
    baseSpreadBps: requireNumericField(
      config.base_spread_bps,
      "Base spread bps"
    ),
    volatilityMultiplierBps: requireNumericField(
      config.volatility_multiplier_bps,
      "Volatility multiplier bps"
    ),
    active: requireBooleanField(executorFields.active, "Active"),
    basePythPriceFeedIdHex: requireFeedIdHex(
      baseCurrency.pyth_price_feed_id,
      "Base Pyth price feed id"
    ),
    quotePythPriceFeedIdHex: requireFeedIdHex(
      quoteCurrency.pyth_price_feed_id,
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
    ),
    outerBalanceBps: requireNumericField(
      config.outer_balance_bps,
      "Outer balance bps"
    ),
    inventorySkewBps: requireNumericField(
      config.inventory_skew_bps,
      "Inventory skew bps"
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
export const DEFAULT_VOLATILITY_MULTIPLIER_BPS = "10000"

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

const resolveVolatilityMultiplierBps = (rawValue?: string): bigint =>
  parseNonNegativeU64(
    rawValue ?? DEFAULT_VOLATILITY_MULTIPLIER_BPS,
    "Volatility multiplier bps"
  )

export const resolveAmmConfigInputs = ({
  volatilityMultiplierBps,
  baseSpreadBps,
  basePythPriceFeedIdHex,
  quotePythPriceFeedIdHex,
  orderExpirationTimeMs,
  maxPriceAgeSecs,
  maxConfRatioBps,
  outerBalanceBps,
  inventorySkewBps
}: {
  volatilityMultiplierBps?: string
  baseSpreadBps?: string
  basePythPriceFeedIdHex: string
  quotePythPriceFeedIdHex: string
  orderExpirationTimeMs?: string
  maxPriceAgeSecs?: string
  maxConfRatioBps?: string
  outerBalanceBps?: string
  inventorySkewBps?: string
}): {
  baseSpreadBps: bigint
  volatilityMultiplierBps: bigint
  basePythPriceFeedIdHex: string
  basePythPriceFeedIdBytes: number[]
  quotePythPriceFeedIdHex: string
  quotePythPriceFeedIdBytes: number[]
  orderExpirationTimeMs: bigint
  maxPriceAgeSecs: bigint
  maxConfRatioBps: bigint
  outerBalanceBps: bigint
  inventorySkewBps: bigint
} => ({
  baseSpreadBps: resolveBaseSpreadBps(baseSpreadBps),
  volatilityMultiplierBps: resolveVolatilityMultiplierBps(volatilityMultiplierBps),
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
  ),
  outerBalanceBps: parseNonNegativeU64(
    outerBalanceBps ?? DEFAULT_OUTER_BALANCE_BPS,
    "Outer balance bps"
  ),
  inventorySkewBps: parseNonNegativeU64(
    inventorySkewBps ?? DEFAULT_INVENTORY_SKEW_BPS,
    "Inventory skew bps"
  )
})
