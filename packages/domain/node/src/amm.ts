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

export const resolveAmmPackageId = async ({
  networkName,
  ammPackageId
}: {
  networkName: string
  ammPackageId?: string
}): Promise<string> => {
  const latestAmmPublishArtifact =
    await getLatestDeploymentFromArtifact(AMM_PACKAGE_NAME)(networkName)

  return normalizeIdOrThrow(
    ammPackageId ?? latestAmmPublishArtifact?.packageId,
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
  const latestConfigArtifact = await getLatestObjectFromArtifact(
    AMM_CONFIG_TYPE_SUFFIX
  )(networkName)

  return normalizeIdOrThrow(
    ammConfigId ?? latestConfigArtifact?.objectId,
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
  const latestAdminCapArtifact = await getLatestObjectFromArtifact(
    AMM_ADMIN_CAP_TYPE_SUFFIX
  )(networkName)

  return normalizeIdOrThrow(
    adminCapId ?? latestAdminCapArtifact?.objectId,
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
