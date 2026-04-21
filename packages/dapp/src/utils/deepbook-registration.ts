import {
  findOwnedTraderAccountIds,
  getTraderAccountOverview,
  resolveTraderAccountType,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import type { Tooling } from "@sui-amm/tooling-node/factory"

export type ResolveTraderAccountResult = {
  traderAccount: TraderAccountOverview
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

const buildModelError = ({
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

const loadTraderAccountOverview = async ({
  tooling,
  traderAccountId,
  ownerAddress,
  ammPackageId
}: {
  tooling: Pick<Tooling, "suiClient">
  traderAccountId: string
  ownerAddress: string
  ammPackageId: string
}): Promise<TraderAccountOverview> => {
  let traderAccount: TraderAccountOverview
  try {
    traderAccount = await getTraderAccountOverview(
      traderAccountId,
      tooling.suiClient
    )
  } catch (error) {
    throw buildModelError({
      operation: "Market maker lookup",
      traderAccountId,
      expectedOwner: ownerAddress,
      expectedPackageId: ammPackageId,
      error
    })
  }

  if (traderAccount.ownerAddress !== ownerAddress)
    throw new Error(
      `Market maker owner mismatch for traderAccountId ${traderAccountId}. Expected owner ${ownerAddress}, found ${traderAccount.ownerAddress}, expected package ${ammPackageId}.`
    )

  return traderAccount
}

const resolveExistingTraderAccountId = async ({
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
      `Multiple owned market makers were found for the active owner (${ownedTraderAccountIds.length}). Provide --trader-account-id to choose one explicitly.`
    )

  return ownedTraderAccountIds[0]
}

export const resolveTraderAccount = async ({
  tooling,
  ammPackageId,
  ownerAddress,
  traderAccountId
}: {
  tooling: Pick<Tooling, "suiClient">
  ammPackageId: string
  ownerAddress: string
  traderAccountId?: string
}): Promise<ResolveTraderAccountResult> => {
  const resolvedTraderAccountId = await resolveExistingTraderAccountId({
    tooling,
    traderAccountId,
    ownerAddress,
    ammPackageId
  })

  if (!resolvedTraderAccountId)
    throw new Error(
      `No market maker found for owner ${ownerAddress} on package ${ammPackageId}. Run amm-create to create one, then re-run this script.`
    )

  return {
    traderAccount: await loadTraderAccountOverview({
      tooling,
      traderAccountId: resolvedTraderAccountId,
      ownerAddress,
      ammPackageId
    })
  }
}
