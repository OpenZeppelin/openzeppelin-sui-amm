import type { SuiClient } from "@mysten/sui/client"
import { AMM_ADMIN_CAP_TYPE_SUFFIX } from "@sui-amm/domain-core/models/amm"
import { getAllOwnedObjectsByFilter } from "@sui-amm/tooling-core/object"

export const resolveAmmAdminCapId = async ({
  ownerAddress,
  packageId,
  suiClient
}: {
  ownerAddress: string
  packageId: string
  suiClient: SuiClient
}): Promise<string | undefined> => {
  const adminCapType = `${packageId}${AMM_ADMIN_CAP_TYPE_SUFFIX}`
  const adminCaps = await getAllOwnedObjectsByFilter(
    {
      ownerAddress,
      filter: { StructType: adminCapType }
    },
    { suiClient }
  )

  return adminCaps[0]?.objectId
}
