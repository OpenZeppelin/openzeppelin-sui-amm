import {
  findOwnedTraderAccountIds,
  getTraderAccountOverview,
  resolveTraderAccountType,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import type { Tooling } from "@sui-amm/tooling-node/factory"

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
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
  if (traderAccountId) return traderAccountId

  const ownedTraderAccountIds = await findOwnedTraderAccountIds({
    ownerAddress,
    packageId: ammPackageId,
    suiClient: tooling.suiClient
  })

  if (ownedTraderAccountIds.length > 1)
    throw new Error(
      `Multiple owned trader accounts were found for the active owner (${ownedTraderAccountIds.length}). Provide --trader-account-id to choose one explicitly.`
    )

  return ownedTraderAccountIds[0]
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
