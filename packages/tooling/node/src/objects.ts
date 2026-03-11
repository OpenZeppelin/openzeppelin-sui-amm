import type { Tooling } from "./factory.ts"
import { waitForObjectState } from "./testing/objects.ts"

export const doesObjectExist = async ({
  tooling,
  objectId
}: {
  tooling: Pick<Tooling, "getObjectSafe">
  objectId: string
}) => {
  const objectResponse = await tooling.getObjectSafe({ objectId })
  return Boolean(objectResponse?.data)
}

export const waitForPackageAvailability = async ({
  packageId,
  tooling,
  label = "package"
}: {
  packageId: string
  tooling: Pick<Tooling, "network" | "suiClient">
  label?: string
}) => {
  if (tooling.network.networkName !== "localnet") {
    return
  }

  await waitForObjectState({
    suiClient: tooling.suiClient,
    objectId: packageId,
    label,
    objectOptions: { showType: true, showContent: true },
    predicate: (response) => response.data?.content?.dataType === "package"
  })
}
