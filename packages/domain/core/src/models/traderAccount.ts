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
  extractFieldValueByKeys,
  unwrapMoveFields
} from "@sui-amm/tooling-core/utils/move-values"

export const MARKET_MAKER_TYPE_SUFFIX = "::executor::MarketMaker"

export const resolveTraderAccountType = (packageId: string) =>
  `${packageId}${MARKET_MAKER_TYPE_SUFFIX}`

export type TraderAccountOverview = {
  traderAccountId: string
  ownerAddress: string
  balanceManagerId: string
  tradeCapId: string
  depositCapId: string
  withdrawCapId: string
}

type TraderAccountFields = {
  owner?: unknown
  balance_manager?: unknown
  balance_manager_id?: unknown
  caps?: unknown
  cap_ids?: unknown
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
    throw new Error("Market maker cap IDs are required.")
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
}) => {
  const ownerField = extractFieldValueByKeys(fields, ["owner"])
  if (typeof ownerField === "string") {
    return extractOwnerAddress({ AddressOwner: ownerField })
  }

  if (owner) {
    return extractOwnerAddress(owner)
  }

  throw new Error("Market maker owner is required.")
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
    withdrawCapId: capIds.withdrawCapId
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
      `Object ${traderAccountId} has unexpected type "${object.type}"; expected "${expectedType}" (likely wrong package id or not a market maker object).`
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
