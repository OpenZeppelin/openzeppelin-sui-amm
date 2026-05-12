import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { AMM_ADMIN_CAP_TYPE_SUFFIX } from "@sui-amm/domain-core/models/amm"
import { getAllOwnedObjectsByFilter } from "@sui-amm/tooling-core/object"

export type OwnedAmmAdminCap = {
  adminCapId: string
  executorId: string
}

const readExecutorIdField = (
  data: { content?: unknown } | undefined
): string | undefined => {
  const content = (
    data as { content?: { dataType?: string; fields?: unknown } } | undefined
  )?.content
  if (!content || content.dataType !== "moveObject") return undefined
  const fields = (content.fields as { executor_id?: unknown } | undefined) ?? {}
  const raw = fields.executor_id
  return typeof raw === "string" ? normalizeSuiObjectId(raw) : undefined
}

/**
 * Lists every AMM `AdminCap` owned by `ownerAddress` for `packageId`, paired
 * with the `executor_id` it controls. Order mirrors what Sui returns, which is
 * stable across calls within the same wallet snapshot.
 */
export const listOwnedAmmAdminCaps = async ({
  ownerAddress,
  packageId,
  suiClient
}: {
  ownerAddress: string
  packageId: string
  suiClient: SuiClient
}): Promise<OwnedAmmAdminCap[]> => {
  const adminCapType = `${packageId}${AMM_ADMIN_CAP_TYPE_SUFFIX}`
  const adminCaps = await getAllOwnedObjectsByFilter(
    {
      ownerAddress,
      filter: { StructType: adminCapType }
    },
    { suiClient }
  )
  return adminCaps.flatMap((entry) => {
    const adminCapId = entry.objectId
    const executorId = readExecutorIdField(entry)
    if (!adminCapId || !executorId) return []
    return [{ adminCapId: normalizeSuiObjectId(adminCapId), executorId }]
  })
}

/**
 * Returns one `AdminCap` for the wallet — preferring `preferredAdminCapId`
 * when the wallet still owns it, otherwise the first listed cap. Used during
 * trader-account resolution so a user-picked executor sticks across reloads.
 */
export const resolveAmmAdminCap = async ({
  ownerAddress,
  packageId,
  preferredAdminCapId,
  suiClient
}: {
  ownerAddress: string
  packageId: string
  preferredAdminCapId?: string
  suiClient: SuiClient
}): Promise<OwnedAmmAdminCap | undefined> => {
  const owned = await listOwnedAmmAdminCaps({
    ownerAddress,
    packageId,
    suiClient
  })
  if (owned.length === 0) return undefined
  if (preferredAdminCapId) {
    const normalized = normalizeSuiObjectId(preferredAdminCapId)
    const match = owned.find((entry) => entry.adminCapId === normalized)
    if (match) return match
  }
  return owned[0]
}

/**
 * Convenience wrapper that returns just the resolved cap's id (or undefined),
 * honoring `preferredAdminCapId` so a wallet with multiple executors can pin
 * a specific one through the modal/edit flows.
 */
export const resolveAmmAdminCapId = async ({
  ownerAddress,
  packageId,
  preferredAdminCapId,
  suiClient
}: {
  ownerAddress: string
  packageId: string
  preferredAdminCapId?: string
  suiClient: SuiClient
}): Promise<string | undefined> =>
  (
    await resolveAmmAdminCap({
      ownerAddress,
      packageId,
      preferredAdminCapId,
      suiClient
    })
  )?.adminCapId
