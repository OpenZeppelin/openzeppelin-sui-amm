import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"

import { getAllDynamicFields } from "@sui-amm/tooling-core/dynamic-fields"
import {
  getAllOwnedObjectsByFilter,
  getSuiObject,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-amm/tooling-core/object"
import {
  extractFieldValueByKeys,
  normalizeBigIntFromMoveValue,
  unwrapMoveFields
} from "@sui-amm/tooling-core/utils/move-values"

export const TRADER_ACCOUNT_TYPE_SUFFIX = "::executor::TraderAccount"

export const resolveTraderAccountType = (packageId: string) =>
  `${packageId}${TRADER_ACCOUNT_TYPE_SUFFIX}`

export type TraderAccountOverview = {
  traderAccountId: string
  ownerAddress: string
  balanceManagerId: string
  tradeCapId: string
  depositCapId: string
  withdrawCapId: string
  activeOrdersTableId?: string
}

export type TraderAccountAssetBalance = {
  coinType: string
  balance: bigint
}

type ResolvedAssetBalanceCandidate = {
  status: "resolved"
  assetBalance: TraderAccountAssetBalance
}

type UnresolvedAssetBalanceCandidate = {
  status: "unresolved"
  dynamicFieldId: string
  coinType?: string
  reason: string
}

type AssetBalanceCandidate =
  | ResolvedAssetBalanceCandidate
  | UnresolvedAssetBalanceCandidate

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

type BalanceManagerFields = {
  balances?: unknown
}

const BALANCE_KEY_TYPE_PREFIX = "::balance_manager::BalanceKey<"

const requireAddressField = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`${label} is required.`)
  return normalizeSuiAddress(value)
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
    throw new Error("Trader account cap IDs are required.")
  }

  const capIds = capIdsFields as TraderAccountCapFields
  return {
    tradeCapId: resolveCapId(capIds.trade_cap_id, "Trade cap id"),
    depositCapId: resolveCapId(capIds.deposit_cap_id, "Deposit cap id"),
    withdrawCapId: resolveCapId(capIds.withdraw_cap_id, "Withdraw cap id")
  }
}

const extractGenericTypeArgument = (
  value: string,
  typePrefix: string
): string | undefined => {
  const prefixIndex = value.indexOf(typePrefix)
  if (prefixIndex < 0) return undefined

  const genericValueStartIndex = prefixIndex + typePrefix.length
  let depth = 1

  for (let index = genericValueStartIndex; index < value.length; index += 1) {
    const currentCharacter = value[index]
    if (currentCharacter === "<") depth += 1
    if (currentCharacter === ">") {
      depth -= 1
      if (depth === 0) {
        const candidateType = value.slice(genericValueStartIndex, index).trim()
        return candidateType || undefined
      }
    }
  }

  return undefined
}

const resolveBalanceManagerBagId = (balanceManagerObject: SuiObjectData) => {
  const fields =
    unwrapMoveObjectFields<BalanceManagerFields>(balanceManagerObject)
  return requireIdField(fields.balances, "Balance manager balances bag id")
}

const resolveCoinTypeFromDynamicField = (
  dynamicField: Awaited<ReturnType<typeof getAllDynamicFields>>[number]
): string | undefined => {
  const fieldTypeCandidates = [
    typeof dynamicField.name?.type === "string"
      ? dynamicField.name.type
      : undefined,
    dynamicField.objectType
  ].filter((candidateType): candidateType is string => Boolean(candidateType))

  const coinTypeCandidate = fieldTypeCandidates
    .map((fieldType) =>
      extractGenericTypeArgument(fieldType, BALANCE_KEY_TYPE_PREFIX)
    )
    .find((fieldType): fieldType is string => Boolean(fieldType))

  return coinTypeCandidate?.trim() || undefined
}

const resolveBalanceAmountFromDynamicFieldObject = (
  dynamicFieldObject: SuiObjectData
): bigint | undefined => {
  const dynamicFieldFields =
    unwrapMoveObjectFields<Record<string, unknown>>(dynamicFieldObject)
  const balanceValue = extractFieldValueByKeys(dynamicFieldFields, ["value"])
  if (balanceValue === undefined) return undefined

  const resolvedBalance = normalizeBigIntFromMoveValue(balanceValue)
  if (resolvedBalance !== undefined) return resolvedBalance

  const nestedBalanceFields = unwrapMoveFields(balanceValue)
  if (!nestedBalanceFields) return undefined

  return normalizeBigIntFromMoveValue(
    extractFieldValueByKeys(nestedBalanceFields, ["value", "balance"])
  )
}

const mergeAndSortAssetBalances = (
  assetBalances: TraderAccountAssetBalance[]
): TraderAccountAssetBalance[] => {
  const balancesByCoinType = assetBalances.reduce<Map<string, bigint>>(
    (nextBalancesByCoinType, assetBalance) => {
      const currentBalance =
        nextBalancesByCoinType.get(assetBalance.coinType) ?? 0n
      nextBalancesByCoinType.set(
        assetBalance.coinType,
        currentBalance + assetBalance.balance
      )

      return nextBalancesByCoinType
    },
    new Map()
  )

  return Array.from(balancesByCoinType.entries())
    .map(([coinType, balance]) => ({
      coinType,
      balance
    }))
    .sort((leftBalance, rightBalance) =>
      leftBalance.coinType.localeCompare(rightBalance.coinType)
    )
}

const buildUnresolvedAssetBalanceCandidate = ({
  dynamicFieldId,
  coinType,
  reason
}: {
  dynamicFieldId: string
  coinType?: string
  reason: string
}): UnresolvedAssetBalanceCandidate => ({
  status: "unresolved",
  dynamicFieldId,
  coinType,
  reason
})

const resolveAssetBalanceFromDynamicField = async ({
  dynamicField,
  suiClient
}: {
  dynamicField: Awaited<ReturnType<typeof getAllDynamicFields>>[number]
  suiClient: SuiClient
}): Promise<AssetBalanceCandidate> => {
  const coinType = resolveCoinTypeFromDynamicField(dynamicField)
  if (!coinType) {
    return buildUnresolvedAssetBalanceCandidate({
      dynamicFieldId: dynamicField.objectId,
      reason: "Unable to resolve the coin type from the dynamic field."
    })
  }

  try {
    const { object } = await getSuiObject(
      {
        objectId: dynamicField.objectId,
        options: { showContent: true, showType: true }
      },
      { suiClient }
    )

    const balance = resolveBalanceAmountFromDynamicFieldObject(object)
    if (balance === undefined) {
      return buildUnresolvedAssetBalanceCandidate({
        dynamicFieldId: dynamicField.objectId,
        coinType,
        reason: "Unable to resolve the balance from the dynamic field object."
      })
    }

    return {
      status: "resolved",
      assetBalance: {
        coinType,
        balance
      }
    }
  } catch (error) {
    return buildUnresolvedAssetBalanceCandidate({
      dynamicFieldId: dynamicField.objectId,
      coinType,
      reason: error instanceof Error ? error.message : String(error)
    })
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
    activeOrdersTableId: normalizeOptionalIdFromValue(fields.active_orders)
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

export const getBalanceManagerAssetBalances = async (
  balanceManagerId: string,
  suiClient: SuiClient
): Promise<TraderAccountAssetBalance[]> => {
  const { object: balanceManagerObject } = await getSuiObject(
    {
      objectId: balanceManagerId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  const balancesBagId = resolveBalanceManagerBagId(balanceManagerObject)
  const dynamicFields = await getAllDynamicFields(
    {
      parentObjectId: balancesBagId
    },
    { suiClient }
  )

  if (dynamicFields.length === 0) return []

  const assetBalanceCandidates = await Promise.all(
    dynamicFields.map((dynamicField) =>
      resolveAssetBalanceFromDynamicField({
        dynamicField,
        suiClient
      })
    )
  )

  const unresolvedAssetBalanceCandidates = assetBalanceCandidates.filter(
    (candidate): candidate is UnresolvedAssetBalanceCandidate =>
      candidate.status === "unresolved"
  )
  if (unresolvedAssetBalanceCandidates.length > 0)
    throw new Error(
      `Unable to resolve ${unresolvedAssetBalanceCandidates.length} balance manager asset balance${
        unresolvedAssetBalanceCandidates.length === 1 ? "" : "s"
      }: ${unresolvedAssetBalanceCandidates
        .map(
          (candidate) =>
            `${candidate.coinType ?? "unknown coin type"} @ ${
              candidate.dynamicFieldId
            } (${candidate.reason})`
        )
        .join("; ")}`
    )

  return mergeAndSortAssetBalances(
    assetBalanceCandidates.reduce<TraderAccountAssetBalance[]>(
      (resolvedAssetBalances, candidate) =>
        candidate.status === "resolved"
          ? [...resolvedAssetBalances, candidate.assetBalance]
          : resolvedAssetBalances,
      []
    )
  )
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
