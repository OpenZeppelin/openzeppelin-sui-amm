import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import {
  AMM_ADMIN_CAP_STORE_TYPE_SUFFIX,
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  AMM_CONFIG_TYPE_SUFFIX,
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildCreateAmmConfigTransaction } from "@sui-amm/domain-core/ptb/amm"
import {
  getAllOwnedObjectsByFilter,
  normalizeIdOrThrow
} from "@sui-amm/tooling-core/object"
import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import {
  findLatestArtifactThat,
  getLatestDeploymentFromArtifact,
  getLatestObjectFromArtifact,
  loadDeploymentArtifacts,
  loadObjectArtifacts
} from "@sui-amm/tooling-node/artifacts"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { doesObjectExist } from "@sui-amm/tooling-node/objects"
import {
  ensureCreatedObject,
  requireCreatedArtifactIdBySuffix
} from "@sui-amm/tooling-node/transactions"

const AMM_PACKAGE_NAME = "openzeppelin_market_maker"

const resolveExplicitId = (
  id: string | undefined,
  errorMessage: string
): string | undefined =>
  id === undefined ? undefined : normalizeIdOrThrow(id, errorMessage)

const resolveIdFromArtifacts = async <Artifact>({
  explicitId,
  networkName,
  errorMessage,
  resolveArtifact,
  getArtifactId
}: {
  explicitId?: string
  networkName: string
  errorMessage: string
  resolveArtifact: (networkName: string) => Promise<Artifact | undefined>
  getArtifactId: (artifact: Artifact | undefined) => string | undefined
}): Promise<string> => {
  if (explicitId) {
    return explicitId
  }

  const artifact = await resolveArtifact(networkName)

  return normalizeIdOrThrow(getArtifactId(artifact), errorMessage)
}

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

  return resolveIdFromArtifacts({
    explicitId: explicitAmmPackageId,
    networkName,
    errorMessage:
      "An AMM package id is required; publish the package or provide --amm-package-id.",
    resolveArtifact: getLatestDeploymentFromArtifact(AMM_PACKAGE_NAME),
    getArtifactId: (artifact) => artifact?.packageId
  })
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

  return resolveIdFromArtifacts({
    explicitId: explicitAmmConfigId,
    networkName,
    errorMessage:
      "An AMM config id is required; create an AMM config first or provide --amm-config-id.",
    resolveArtifact: getLatestObjectFromArtifact(AMM_CONFIG_TYPE_SUFFIX),
    getArtifactId: (artifact) => artifact?.objectId
  })
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

  return resolveIdFromArtifacts({
    explicitId: explicitAdminCapId,
    networkName,
    errorMessage:
      "An AMM admin cap id is required; publish the package or provide --admin-cap-id.",
    resolveArtifact: getLatestObjectFromArtifact(AMM_ADMIN_CAP_TYPE_SUFFIX),
    getArtifactId: (artifact) => artifact?.objectId
  })
}

export type AmmConfigSnapshot = {
  ammConfigOverview: AmmConfigOverview
  initialSharedVersion: string
}

export type AmmConfigInputs = ReturnType<typeof resolveAmmConfigInputs>

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

export const resolveExistingAmmConfigIdFromArtifacts = async ({
  tooling,
  networkName,
  ammPackageId
}: {
  tooling: Pick<Tooling, "getObjectSafe">
  networkName: string
  ammPackageId: string
}): Promise<string | undefined> => {
  const objectArtifacts = await loadObjectArtifacts(networkName)
  const normalizedPackageId = normalizeSuiObjectId(ammPackageId)

  for (
    let artifactIndex = objectArtifacts.length - 1;
    artifactIndex >= 0;
    artifactIndex -= 1
  ) {
    const artifact = objectArtifacts[artifactIndex]

    if (!artifact?.objectType?.endsWith(AMM_CONFIG_TYPE_SUFFIX)) {
      continue
    }

    if (normalizeSuiObjectId(artifact.packageId) !== normalizedPackageId) {
      continue
    }

    const normalizedObjectId = normalizeSuiObjectId(artifact.objectId)
    const objectExists = await doesObjectExist({
      tooling,
      objectId: normalizedObjectId
    })

    if (objectExists) {
      return normalizedObjectId
    }
  }

  return undefined
}

export const createAmmConfigSnapshot = async ({
  tooling,
  ammPackageId,
  adminCapId,
  ammConfigInputs
}: {
  tooling: Tooling
  ammPackageId: string
  adminCapId: string
  ammConfigInputs: AmmConfigInputs
}): Promise<{
  ammConfigSnapshot: AmmConfigSnapshot
  transactionSummary?: { label?: string }
}> => {
  const createAmmTransaction = buildCreateAmmConfigTransaction({
    packageId: ammPackageId,
    adminCapId,
    baseSpreadBps: ammConfigInputs.baseSpreadBps,
    volatilityMultiplierBps: ammConfigInputs.volatilityMultiplierBps,
    useLaser: ammConfigInputs.useLaser,
    pythPriceFeedIdBytes: ammConfigInputs.pythPriceFeedIdBytes
  })

  const { execution, summary } = await tooling.executeTransactionWithSummary({
    transaction: createAmmTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: "create-amm"
  })

  if (!execution) {
    throw new Error("AMM config creation did not execute.")
  }

  const ammConfigId = requireCreatedArtifactIdBySuffix({
    createdArtifacts: execution.objectArtifacts.created,
    suffix: AMM_CONFIG_TYPE_SUFFIX,
    label: "AMM config"
  })

  return {
    ammConfigSnapshot: await collectAmmConfigSnapshot({
      tooling,
      ammConfigId
    }),
    transactionSummary: summary
  }
}

export const createAmmConfigSnapshotFromArgs = async ({
  tooling,
  ammPackageId,
  adminCapId,
  pythPriceFeedIdHex,
  baseSpreadBps,
  volatilityMultiplierBps,
  useLaser
}: {
  tooling: Tooling
  ammPackageId: string
  adminCapId: string
  pythPriceFeedIdHex: string
  baseSpreadBps?: string
  volatilityMultiplierBps?: string
  useLaser?: boolean
}): Promise<{
  ammConfigSnapshot: AmmConfigSnapshot
  pythPriceFeedIdHex: string
  transactionSummary?: { label?: string }
}> => {
  const ammConfigInputs = resolveAmmConfigInputs({
    pythPriceFeedIdHex,
    volatilityMultiplierBps,
    baseSpreadBps,
    useLaser
  })

  const createdAmmConfig = await createAmmConfigSnapshot({
    tooling,
    ammPackageId,
    adminCapId,
    ammConfigInputs
  })

  return {
    ...createdAmmConfig,
    pythPriceFeedIdHex: ammConfigInputs.pythPriceFeedIdHex
  }
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
