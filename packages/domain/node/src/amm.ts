import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  AMM_ADMIN_CAP_STORE_TYPE_SUFFIX,
  AMM_CONFIG_TYPE_SUFFIX,
  getAmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import {
  getAllOwnedObjectsByFilter,
  normalizeIdOrThrow
} from "@sui-amm/tooling-core/object"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import {
  findLatestArtifactThat,
  getLatestObjectFromArtifact,
  isPublishArtifactNamed,
  loadDeploymentArtifacts
} from "@sui-amm/tooling-node/artifacts"
import type { Tooling } from "@sui-amm/tooling-node/factory"

const AMM_PACKAGE_NAME = "prop_amm"

export const isAmmPublishArtifact = (artifact: PublishArtifact) =>
  isPublishArtifactNamed(AMM_PACKAGE_NAME)(artifact)

export const resolveAmmPackageId = async ({
  networkName,
  ammPackageId
}: {
  networkName: string
  ammPackageId?: string
}): Promise<string> => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)
  const latestAmmPublishArtifact = findLatestArtifactThat(
    isAmmPublishArtifact,
    deploymentArtifacts
  )

  return normalizeIdOrThrow(
    ammPackageId ?? latestAmmPublishArtifact?.packageId,
    "An AMM package id is required; publish the package or provide --amm-package-id."
  )
}

const resolveAmmPublishArtifactById = async ({
  networkName,
  ammPackageId
}: {
  networkName: string
  ammPackageId: string
}): Promise<PublishArtifact | undefined> => {
  const normalizedPackageId = normalizeSuiObjectId(ammPackageId)
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)

  return findLatestArtifactThat(
    (artifact) =>
      normalizeSuiObjectId(artifact.packageId) === normalizedPackageId,
    deploymentArtifacts
  )
}

export const resolveAmmAdminCapStoreIdFromPublishDigest = async ({
  publishDigest,
  suiClient
}: {
  publishDigest: string
  suiClient: SuiClient
}): Promise<string> => {
  const publishTransaction = await suiClient.getTransactionBlock({
    digest: publishDigest,
    options: { showObjectChanges: true }
  })

  return ensureCreatedObject(
    AMM_ADMIN_CAP_STORE_TYPE_SUFFIX,
    publishTransaction
  ).objectId
}

export const resolveAmmAdminCapStoreId = async ({
  networkName,
  ammPackageId,
  suiClient
}: {
  networkName: string
  ammPackageId: string
  suiClient: SuiClient
}): Promise<string> => {
  const publishArtifact = await resolveAmmPublishArtifactById({
    networkName,
    ammPackageId
  })

  if (!publishArtifact?.digest)
    throw new Error(
      "Unable to locate the latest AMM publish artifact; provide --admin-cap-id or re-run publish to refresh deployments."
    )

  return resolveAmmAdminCapStoreIdFromPublishDigest({
    publishDigest: publishArtifact.digest,
    suiClient
  })
}

export const resolveOwnedAmmAdminCapId = async ({
  ammPackageId,
  ownerAddress,
  suiClient
}: {
  ammPackageId: string
  ownerAddress: string
  suiClient: SuiClient
}): Promise<string | undefined> => {
  const adminCaps = await getAllOwnedObjectsByFilter(
    {
      ownerAddress,
      filter: {
        StructType: `${normalizeSuiObjectId(ammPackageId)}${AMM_ADMIN_CAP_TYPE_SUFFIX}`
      }
    },
    { suiClient }
  )

  return adminCaps[0]?.objectId
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
