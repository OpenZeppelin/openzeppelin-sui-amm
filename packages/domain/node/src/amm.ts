import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  AMM_CONFIG_TYPE_SUFFIX,
  getAmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import { normalizeIdOrThrow } from "@sui-amm/tooling-core/object"
import {
  getLatestDeploymentFromArtifact,
  getLatestObjectFromArtifact
} from "@sui-amm/tooling-node/artifacts"
import type { Tooling } from "@sui-amm/tooling-node/factory"

const AMM_PACKAGE_NAME = "openzeppelin_market_maker"

const resolveExplicitId = (
  id: string | undefined,
  errorMessage: string
): string | undefined =>
  id === undefined ? undefined : normalizeIdOrThrow(id, errorMessage)

export const resolveAmmPackageId = async ({
  networkName,
  ammPackageId
}: {
  networkName: string
  ammPackageId?: string
}): Promise<string> => {
  const explicitAmmPackageId = resolveExplicitId(
    ammPackageId,
    "An AMM package id is required; publish the package or provide --amm-package-id."
  )
  if (explicitAmmPackageId) {
    return explicitAmmPackageId
  }

  const latestAmmPublishArtifact =
    await getLatestDeploymentFromArtifact(AMM_PACKAGE_NAME)(networkName)

  return normalizeIdOrThrow(
    latestAmmPublishArtifact?.packageId,
    "An AMM package id is required; publish the package or provide --amm-package-id."
  )
}

export const resolveAmmConfigId = async ({
  networkName,
  ammConfigId
}: {
  networkName: string
  ammConfigId?: string
}): Promise<string> => {
  const explicitAmmConfigId = resolveExplicitId(
    ammConfigId,
    "An AMM config id is required; create an AMM config first or provide --amm-config-id."
  )
  if (explicitAmmConfigId) {
    return explicitAmmConfigId
  }

  const latestConfigArtifact = await getLatestObjectFromArtifact(
    AMM_CONFIG_TYPE_SUFFIX
  )(networkName)

  return normalizeIdOrThrow(
    latestConfigArtifact?.objectId,
    "An AMM config id is required; create an AMM config first or provide --amm-config-id."
  )
}

export const resolveAmmAdminCapId = async ({
  networkName,
  adminCapId
}: {
  networkName: string
  adminCapId?: string
}): Promise<string> => {
  const explicitAdminCapId = resolveExplicitId(
    adminCapId,
    "An AMM admin cap id is required; publish the package or provide --admin-cap-id."
  )
  if (explicitAdminCapId) {
    return explicitAdminCapId
  }

  const latestAdminCapArtifact = await getLatestObjectFromArtifact(
    AMM_ADMIN_CAP_TYPE_SUFFIX
  )(networkName)

  return normalizeIdOrThrow(
    latestAdminCapArtifact?.objectId,
    "An AMM admin cap id is required; publish the package or provide --admin-cap-id."
  )
}

export type AmmConfigSnapshot = {
  ammConfigOverview: AmmConfigOverview
  initialSharedVersion: string
}

export const collectAmmConfigSnapshot = async ({
  tooling,
  ammConfigId
}: {
  tooling: Pick<Tooling, "suiClient" | "getImmutableSharedObject">
  ammConfigId: string
}): Promise<AmmConfigSnapshot> => {
  const [ammConfigOverview, sharedObject] = await Promise.all([
    getAmmConfigOverview(ammConfigId, tooling.suiClient),
    tooling.getImmutableSharedObject({ objectId: ammConfigId })
  ])

  return {
    ammConfigOverview,
    initialSharedVersion: sharedObject.sharedRef.initialSharedVersion
  }
}
