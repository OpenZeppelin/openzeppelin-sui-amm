import {
  findOwnedTraderAccountIds,
  getTraderAccountOverview,
  resolveTraderAccountType,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import { getSuiObject } from "@sui-amm/tooling-core/object"
import {
  isMatchingTypeName,
  parseTypeNameFromString
} from "@sui-amm/tooling-core/utils/type-name"
import type { Tooling } from "@sui-amm/tooling-node/factory"

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

const buildTraderAccountTypeMismatchError = ({
  operation,
  traderAccountId,
  expectedOwner,
  expectedPackageId,
  actualType
}: {
  operation: string
  traderAccountId: string
  expectedOwner: string
  expectedPackageId: string
  actualType?: string
}) =>
  new Error(
    `${operation} failed for traderAccountId ${traderAccountId} (expected owner ${expectedOwner}, expected package ${expectedPackageId}, expected type ${resolveTraderAccountType(
      expectedPackageId
    )}). Cause: Trader account type mismatch${actualType ? ` (${actualType})` : ""}.`
  )

const assertTraderAccountTypeMatches = async ({
  tooling,
  traderAccountId,
  ownerAddress,
  ammPackageId,
  operation
}: {
  tooling: Pick<Tooling, "suiClient">
  traderAccountId: string
  ownerAddress: string
  ammPackageId: string
  operation: string
}) => {
  const { object } = await getSuiObject(
    {
      objectId: traderAccountId,
      options: { showType: true }
    },
    { suiClient: tooling.suiClient }
  )

  const expectedTraderAccountType = parseTypeNameFromString(
    resolveTraderAccountType(ammPackageId)
  )

  if (isMatchingTypeName(expectedTraderAccountType, object.type || undefined))
    return

  throw buildTraderAccountTypeMismatchError({
    operation,
    traderAccountId,
    expectedOwner: ownerAddress,
    expectedPackageId: ammPackageId,
    actualType: object.type || undefined
  })
}

export const buildTraderAccountModelError = ({
  operation,
  traderAccountId,
  expectedOwner,
  expectedPackageId,
  error
}: {
  operation: string
  traderAccountId: string
  expectedOwner: string
  expectedPackageId: string
  error: unknown
}) =>
  new Error(
    `${operation} failed for traderAccountId ${traderAccountId} (expected owner ${expectedOwner}, expected package ${expectedPackageId}, expected type ${resolveTraderAccountType(
      expectedPackageId
    )}). Cause: ${getErrorMessage(error)}`
  )

export const resolveOwnedTraderAccountId = async ({
  tooling,
  traderAccountId,
  ownerAddress,
  ammPackageId
}: {
  tooling: Pick<Tooling, "suiClient">
  traderAccountId?: string
  ownerAddress: string
  ammPackageId: string
}): Promise<string | undefined> => {
  if (traderAccountId) {
    await assertTraderAccountTypeMatches({
      tooling,
      traderAccountId,
      ownerAddress,
      ammPackageId,
      operation: "Owned trader account lookup"
    })
    return traderAccountId
  }

  const ownedTraderAccountIds = await findOwnedTraderAccountIds({
    ownerAddress,
    packageId: ammPackageId,
    suiClient: tooling.suiClient
  })

  if (ownedTraderAccountIds.length > 1)
    throw new Error(
      `Multiple owned trader accounts were found for the active owner (${ownedTraderAccountIds.length}). Provide --trader-account-id to choose one explicitly.`
    )

  const ownedTraderAccountId = ownedTraderAccountIds[0]
  if (!ownedTraderAccountId) return undefined

  await assertTraderAccountTypeMatches({
    tooling,
    traderAccountId: ownedTraderAccountId,
    ownerAddress,
    ammPackageId,
    operation: "Owned trader account lookup"
  })

  return ownedTraderAccountId
}

export const getOwnedTraderAccountOverview = async ({
  tooling,
  traderAccountId,
  ownerAddress,
  ammPackageId,
  operation
}: {
  tooling: Pick<Tooling, "suiClient">
  traderAccountId: string
  ownerAddress: string
  ammPackageId: string
  operation: string
}): Promise<TraderAccountOverview> => {
  let traderAccount: TraderAccountOverview
  try {
    await assertTraderAccountTypeMatches({
      tooling,
      traderAccountId,
      ownerAddress,
      ammPackageId,
      operation
    })
    traderAccount = await getTraderAccountOverview(
      traderAccountId,
      tooling.suiClient
    )
  } catch (error) {
    throw buildTraderAccountModelError({
      operation,
      traderAccountId,
      expectedOwner: ownerAddress,
      expectedPackageId: ammPackageId,
      error
    })
  }

  if (traderAccount.ownerAddress !== ownerAddress)
    throw new Error(
      `Trader account owner mismatch for traderAccountId ${traderAccountId}. Expected owner ${ownerAddress}, found ${traderAccount.ownerAddress}, expected package ${ammPackageId}.`
    )

  return traderAccount
}
