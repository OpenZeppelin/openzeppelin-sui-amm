import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"

import {
  getAllOwnedObjectsByFilter,
  getSuiObject,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-amm/tooling-core/object"
import { unwrapMoveFields } from "@sui-amm/tooling-core/utils/move-values"

export const TRADER_ACCOUNT_TYPE_SUFFIX = "::executor::TraderAccount"

export const resolveTraderAccountType = (packageId: string) =>
  `${packageId}${TRADER_ACCOUNT_TYPE_SUFFIX}`

export type TraderAccountOverview = {
  traderAccountId: string
  ownerAddress: string
  balanceManagerId: string
  tradeCapId?: string
  depositCapId?: string
  withdrawCapId?: string
  activeOrdersTableId?: string
}

type TraderAccountFields = {
  owner?: unknown
  balance_manager_id?: unknown
  cap_ids?: unknown
  active_orders?: unknown
}

type TraderAccountCapFields = {
  trade_cap_id?: unknown
  deposit_cap_id?: unknown
  withdraw_cap_id?: unknown
}

const requireAddressField = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`${label} is required.`)
  return normalizeSuiAddress(value)
}

const requireIdField = (value: unknown, label: string): string => {
  const normalized = normalizeOptionalIdFromValue(value)
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

const resolveCapId = (value: unknown) => normalizeOptionalIdFromValue(value)

const resolveCapIds = (capIdsValue: unknown) => {
  const capIdsFields = unwrapMoveFields(capIdsValue)
  if (!capIdsFields) {
    return {
      tradeCapId: undefined,
      depositCapId: undefined,
      withdrawCapId: undefined
    }
  }

  const capIds = capIdsFields as TraderAccountCapFields
  return {
    tradeCapId: resolveCapId(capIds.trade_cap_id),
    depositCapId: resolveCapId(capIds.deposit_cap_id),
    withdrawCapId: resolveCapId(capIds.withdraw_cap_id)
  }
}

const buildTraderAccountOverviewFromObject = ({
  traderAccountId,
  object
}: {
  traderAccountId: string
  object: SuiObjectData
}): TraderAccountOverview => {
  const fields = unwrapMoveObjectFields<TraderAccountFields>(object)
  const capIds = resolveCapIds(fields.cap_ids)

  return {
    traderAccountId: normalizeSuiObjectId(traderAccountId),
    ownerAddress: requireAddressField(fields.owner, "Trader account owner"),
    balanceManagerId: requireIdField(
      fields.balance_manager_id,
      "Balance manager id"
    ),
    tradeCapId: capIds.tradeCapId,
    depositCapId: capIds.depositCapId,
    withdrawCapId: capIds.withdrawCapId,
    activeOrdersTableId: resolveCapId(fields.active_orders)
  }
}

export const getTraderAccountOverview = async (
  traderAccountId: string,
  suiClient: SuiClient
): Promise<TraderAccountOverview> => {
  const { object } = await getSuiObject(
    {
      objectId: traderAccountId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  return buildTraderAccountOverviewFromObject({
    traderAccountId,
    object
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
