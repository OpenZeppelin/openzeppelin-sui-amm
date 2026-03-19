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

export const AMM_CONFIG_TYPE_SUFFIX = "::manager::AMMConfig"
export const AMM_ADMIN_CAP_TYPE_SUFFIX = "::manager::AMMAdminCap"
export const PROP_AMM_EXECUTOR_SUFFIX = "::executor::PropAmmApp"

export const MAX_BASE_SPREAD_BPS = "10000"

export type AmmConfigOverview = {
  configId: string
  baseSpreadBps: string
  volatilitySpreadBps: string
  useLaser: boolean
  tradingPaused: boolean
  pythPriceFeedIdHex: string
}

type AmmConfigFields = {
  base_spread_bps?: unknown
  volatility_spread_bps?: unknown
  use_laser?: unknown
  trading_paused?: unknown
  pyth_price_feed_id?: unknown
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

const requireFeedIdHex = (value: unknown): string => {
  const formatted = formatVectorBytesAsHex(value)
  if (formatted === "Unknown") {
    throw new Error("Pyth price feed id is required.")
  }

  return formatted
}

const buildAmmConfigOverviewFromObject = ({
  configId,
  object
}: {
  configId: string
  object: SuiObjectData
}): AmmConfigOverview => {
  const fields = unwrapMoveObjectFields<AmmConfigFields>(object)
  return {
    configId,
    baseSpreadBps: requireNumericField(
      fields.base_spread_bps,
      "Base spread bps"
    ),
    volatilitySpreadBps: requireNumericField(
      fields.volatility_spread_bps,
      "Volatility spread bps"
    ),
    useLaser: requireBooleanField(fields.use_laser, "Use laser flag"),
    tradingPaused: requireBooleanField(fields.trading_paused, "Trading paused"),
    pythPriceFeedIdHex: requireFeedIdHex(fields.pyth_price_feed_id)
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

const resolvevolatilitySpreadBps = (rawValue?: string): bigint =>
  parseNonNegativeU64(
    rawValue ?? DEFAULT_VOLATILITY_SPREAD_BPS,
    "Volatility spread bps"
  )

const resolveUseLaserFlag = (rawValue?: boolean): boolean => rawValue ?? false

export const resolveAmmConfigInputs = ({
  volatilitySpreadBps,
  baseSpreadBps,
  useLaser,
  pythPriceFeedIdHex
}: {
  volatilitySpreadBps?: string
  baseSpreadBps?: string
  useLaser?: boolean
  pythPriceFeedIdHex: string
}): {
  baseSpreadBps: bigint
  volatilitySpreadBps: bigint
  useLaser: boolean
  pythPriceFeedIdHex: string
  pythPriceFeedIdBytes: number[]
} => ({
  baseSpreadBps: resolveBaseSpreadBps(baseSpreadBps),
  volatilitySpreadBps: resolvevolatilitySpreadBps(volatilitySpreadBps),
  useLaser: resolveUseLaserFlag(useLaser),
  pythPriceFeedIdHex,
  pythPriceFeedIdBytes: parsePythPriceFeedIdBytes(pythPriceFeedIdHex)
})
