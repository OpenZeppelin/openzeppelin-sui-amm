import type { ObjectOwner, SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import {
  extractOwnerAddress,
  getAllOwnedObjectsByFilter,
  getSuiObject,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-amm/tooling-core/object"
import {
  formatOptionalNumericValue,
  parseOptionalNumber
} from "@sui-amm/tooling-core/utils/formatters"
import {
  extractFieldValueByKeys,
  unwrapMoveFields
} from "@sui-amm/tooling-core/utils/move-values"
import { formatTypeNameFromFieldValue } from "@sui-amm/tooling-core/utils/type-name"

export const EXECUTOR_TYPE_SUFFIX = "::executor::Executor"

export const resolveTraderAccountType = (packageId: string) =>
  `${packageId}${EXECUTOR_TYPE_SUFFIX}`

export type TraderAccountOverview = {
  traderAccountId: string
  /**
   * Address owner of the executor. Post-refactor the Executor is a shared
   * object, so this is `undefined`; callers should fall back to the AdminCap
   * holder's address when they need a "controller" to display.
   */
  ownerAddress: string | undefined
  balanceManagerId: string
  tradeCapId: string
  depositCapId: string
  withdrawCapId: string
  /** Whether the executor is currently active (trading) or paused. */
  active: boolean
  /** Base asset Move type tag cached in the `Market`. */
  baseCoinType: string
  /** Quote asset Move type tag cached in the `Market`. */
  quoteCoinType: string
  /** Cached decimals for the base asset (from `Market.base.decimals`). */
  baseDecimals: number
  /** Cached decimals for the quote asset (from `Market.quote.decimals`). */
  quoteDecimals: number
  /** Object ID of the DeepBook pool bound to this executor's Market. */
  poolId: string
  /** Current base-asset balance in the BalanceManager (u64, atoms). */
  baseBalance: string
  /** Current quote-asset balance in the BalanceManager (u64, atoms). */
  quoteBalance: string
}

type TraderAccountFields = {
  owner?: unknown
  balance_manager?: unknown
  balance_manager_id?: unknown
  caps?: unknown
  cap_ids?: unknown
  active?: unknown
  market?: unknown
  info?: unknown
}

type MarketFields = {
  pool_id?: unknown
  base?: unknown
  quote?: unknown
}

type MarketCurrencyFields = {
  coin_type?: unknown
  decimals?: unknown
}

type InfoFields = {
  base_balance?: unknown
  quote_balance?: unknown
}

type TraderAccountCapFields = {
  trade_cap?: unknown
  trade_cap_id?: unknown
  deposit_cap?: unknown
  deposit_cap_id?: unknown
  withdraw_cap?: unknown
  withdraw_cap_id?: unknown
}

const requireIdField = (value: unknown, label: string): string => {
  const normalized = normalizeOptionalIdFromValue(value)
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

const resolveCapId = (value: unknown, label: string) => {
  const normalized = normalizeOptionalIdFromValue(value)
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

const resolveCapIds = (capIdsValue: unknown) => {
  const capIdsFields = unwrapMoveFields(capIdsValue)
  if (!capIdsFields) {
    throw new Error("Market maker executor cap IDs are required.")
  }

  const capIds = capIdsFields as TraderAccountCapFields
  return {
    tradeCapId: resolveCapId(
      extractFieldValueByKeys(capIds, ["trade_cap", "trade_cap_id"]),
      "Trade cap id"
    ),
    depositCapId: resolveCapId(
      extractFieldValueByKeys(capIds, ["deposit_cap", "deposit_cap_id"]),
      "Deposit cap id"
    ),
    withdrawCapId: resolveCapId(
      extractFieldValueByKeys(capIds, ["withdraw_cap", "withdraw_cap_id"]),
      "Withdraw cap id"
    )
  }
}

const resolveOwnerAddress = ({
  fields,
  owner
}: {
  fields: TraderAccountFields
  owner?: ObjectOwner
}): string | undefined => {
  const ownerField = extractFieldValueByKeys(fields, ["owner"])
  if (typeof ownerField === "string") {
    return extractOwnerAddress({ AddressOwner: ownerField })
  }

  if (!owner) return undefined

  try {
    return extractOwnerAddress(owner)
  } catch {
    // Shared / immutable objects are not address-owned. Post-refactor the
    // Executor is shared, so this is expected.
    return undefined
  }
}

const requireDecimals = (value: unknown, label: string): number => {
  const parsed = parseOptionalNumber(value)
  if (parsed === undefined) throw new Error(`${label} is required.`)
  if (parsed < 0 || parsed > 255) {
    throw new Error(`${label} is out of range (0..255).`)
  }
  return parsed
}

const resolveMarketInfo = (fields: TraderAccountFields) => {
  const marketFields = unwrapMoveFields(
    extractFieldValueByKeys(fields, ["market"])
  ) as MarketFields | undefined
  if (!marketFields) {
    throw new Error("Market maker executor market metadata is required.")
  }

  const poolId = requireIdField(
    extractFieldValueByKeys(marketFields, ["pool_id"]),
    "Market pool id"
  )

  const baseFields = unwrapMoveFields(
    extractFieldValueByKeys(marketFields, ["base"])
  ) as MarketCurrencyFields | undefined
  const quoteFields = unwrapMoveFields(
    extractFieldValueByKeys(marketFields, ["quote"])
  ) as MarketCurrencyFields | undefined
  if (!baseFields || !quoteFields) {
    throw new Error("Market maker executor base/quote currency is required.")
  }

  const baseCoinType = formatTypeNameFromFieldValue(
    extractFieldValueByKeys(baseFields, ["coin_type"])
  )
  const quoteCoinType = formatTypeNameFromFieldValue(
    extractFieldValueByKeys(quoteFields, ["coin_type"])
  )
  if (!baseCoinType || !quoteCoinType) {
    throw new Error("Market maker executor base/quote coin type is required.")
  }

  const baseDecimals = requireDecimals(
    extractFieldValueByKeys(baseFields, ["decimals"]),
    "Base decimals"
  )
  const quoteDecimals = requireDecimals(
    extractFieldValueByKeys(quoteFields, ["decimals"]),
    "Quote decimals"
  )

  return {
    poolId,
    baseCoinType,
    quoteCoinType,
    baseDecimals,
    quoteDecimals
  }
}

const resolveInfoBalances = (fields: TraderAccountFields) => {
  const infoFields = unwrapMoveFields(
    extractFieldValueByKeys(fields, ["info"])
  ) as InfoFields | undefined
  if (!infoFields) {
    throw new Error("Market maker executor info struct is required.")
  }

  const baseBalance = formatOptionalNumericValue(
    extractFieldValueByKeys(infoFields, ["base_balance"])
  )
  const quoteBalance = formatOptionalNumericValue(
    extractFieldValueByKeys(infoFields, ["quote_balance"])
  )
  if (baseBalance === undefined || quoteBalance === undefined) {
    throw new Error("Market maker executor info balances are required.")
  }

  return { baseBalance, quoteBalance }
}

const buildTraderAccountOverviewFromObject = ({
  traderAccountId,
  object,
  owner
}: {
  traderAccountId: string
  object: SuiObjectData
  owner?: ObjectOwner
}): TraderAccountOverview => {
  const fields = unwrapMoveObjectFields<TraderAccountFields>(object)
  const capIds = resolveCapIds(
    extractFieldValueByKeys(fields, ["caps", "cap_ids"])
  )
  const activeField = extractFieldValueByKeys(fields, ["active"])
  if (typeof activeField !== "boolean") {
    throw new Error("Market maker executor active flag is required.")
  }
  const market = resolveMarketInfo(fields)
  const info = resolveInfoBalances(fields)

  return {
    traderAccountId: normalizeSuiObjectId(traderAccountId),
    ownerAddress: resolveOwnerAddress({ fields, owner }),
    balanceManagerId: requireIdField(
      extractFieldValueByKeys(fields, [
        "balance_manager",
        "balance_manager_id"
      ]),
      "Balance manager id"
    ),
    tradeCapId: capIds.tradeCapId,
    depositCapId: capIds.depositCapId,
    withdrawCapId: capIds.withdrawCapId,
    active: activeField,
    baseCoinType: market.baseCoinType,
    quoteCoinType: market.quoteCoinType,
    baseDecimals: market.baseDecimals,
    quoteDecimals: market.quoteDecimals,
    poolId: market.poolId,
    baseBalance: info.baseBalance,
    quoteBalance: info.quoteBalance
  }
}

export const getTraderAccountOverview = async (
  traderAccountId: string,
  suiClient: SuiClient,
  ammPackageId: string
): Promise<TraderAccountOverview> => {
  const { object, owner } = await getSuiObject(
    {
      objectId: traderAccountId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  const expectedType = resolveTraderAccountType(ammPackageId)
  if (object.type !== expectedType)
    throw new Error(
      `Object ${traderAccountId} has unexpected type "${object.type}"; expected "${expectedType}" (likely wrong package id or not a market maker executor object).`
    )

  return buildTraderAccountOverviewFromObject({
    traderAccountId,
    object,
    owner
  })
}

export const findOwnedTraderAccountIds = async ({
  ownerAddress,
  packageId,
  suiClient
}: {
  ownerAddress: string
  packageId: string
  suiClient: SuiClient
}): Promise<string[]> => {
  const objects = await getAllOwnedObjectsByFilter(
    {
      ownerAddress,
      filter: { StructType: resolveTraderAccountType(packageId) },
      options: { showType: true }
    },
    { suiClient }
  )

  return objects
    .flatMap((object) =>
      object.objectId ? [normalizeSuiObjectId(object.objectId)] : []
    )
    .sort((leftId, rightId) => leftId.localeCompare(rightId))
}
