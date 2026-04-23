import path from "node:path"

import type { SuiClient } from "@mysten/sui/client"
import {
  normalizeStructTag,
  normalizeSuiObjectId,
  parseStructTag
} from "@mysten/sui/utils"
import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildCreateExecutorTransaction } from "@sui-amm/domain-core/ptb/amm"
import { EXECUTOR_TYPE_SUFFIX } from "@sui-amm/domain-core/models/traderAccount"
import { deriveCurrencyObjectId } from "@sui-amm/tooling-core/coin-registry"
import { SUI_COIN_REGISTRY_ID } from "@sui-amm/tooling-core/constants"
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
import { requireCreatedArtifactIdBySuffix } from "@sui-amm/tooling-node/transactions"

export const AMM_PACKAGE_NAME = "openzeppelin_market_maker"
export const AMM_PACKAGE_FOLDER_NAME = "prop-amm"
export const AMM_DEEPBOOK_DEPENDENCY_NAME = "deepbook"

const resolveExplicitId = (
  id: string | undefined,
  errorMessage: string
): string | undefined =>
  id === undefined ? undefined : normalizeIdOrThrow(id, errorMessage)

const isAmmDeploymentArtifact = (artifact: PublishArtifact): boolean => {
  const normalizedPackageName = artifact.packageName?.trim().toLowerCase()
  if (normalizedPackageName === AMM_PACKAGE_NAME) {
    return true
  }

  const packageFolderName = path
    .basename(artifact.packagePath)
    .trim()
    .toLowerCase()
  return packageFolderName === AMM_PACKAGE_FOLDER_NAME
}

const resolveLatestAmmDeploymentArtifact = async (networkName: string) => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)

  return (
    findLatestArtifactThat(isAmmDeploymentArtifact, deploymentArtifacts) ??
    getLatestDeploymentFromArtifact(AMM_PACKAGE_NAME)(networkName)
  )
}

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
    resolveArtifact: resolveLatestAmmDeploymentArtifact,
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
    resolveArtifact: getLatestObjectFromArtifact(EXECUTOR_TYPE_SUFFIX),
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

    if (!artifact?.objectType?.endsWith(EXECUTOR_TYPE_SUFFIX)) {
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

const extractPoolAssetTypeTags = (
  poolType: string
): { baseAssetTypeTag: string; quoteAssetTypeTag: string } => {
  const structTag = parseStructTag(poolType)
  if (structTag.typeParams.length !== 2) {
    throw new Error(
      `Expected DeepBook pool type to have two type params, got ${poolType}.`
    )
  }

  return {
    baseAssetTypeTag: normalizeStructTag(structTag.typeParams[0]),
    quoteAssetTypeTag: normalizeStructTag(structTag.typeParams[1])
  }
}

export const createAmmConfigSnapshot = async ({
  tooling,
  ammPackageId,
  poolId,
  ammConfigInputs
}: {
  tooling: Tooling
  ammPackageId: string
  poolId: string
  ammConfigInputs: AmmConfigInputs
}): Promise<{
  ammConfigSnapshot: AmmConfigSnapshot
  adminCapId: string
  transactionSummary?: { label?: string }
}> => {
  const senderAddress = tooling.loadedEd25519KeyPair.toSuiAddress()

  const pool = await tooling.getImmutableSharedObject({ objectId: poolId })
  const poolType = pool.object.type
  if (!poolType) {
    throw new Error(`DeepBook pool ${poolId} has no resolvable Move type.`)
  }
  const { baseAssetTypeTag, quoteAssetTypeTag } =
    extractPoolAssetTypeTags(poolType)

  const [baseCurrency, quoteCurrency] = await Promise.all([
    tooling.getImmutableSharedObject({
      objectId: deriveCurrencyObjectId(baseAssetTypeTag, SUI_COIN_REGISTRY_ID)
    }),
    tooling.getImmutableSharedObject({
      objectId: deriveCurrencyObjectId(quoteAssetTypeTag, SUI_COIN_REGISTRY_ID)
    })
  ])

  const createExecutorTransaction = buildCreateExecutorTransaction({
    packageId: ammPackageId,
    pool,
    baseCurrency,
    quoteCurrency,
    baseAssetTypeTag,
    quoteAssetTypeTag,
    senderAddress,
    baseSpreadBps: ammConfigInputs.baseSpreadBps,
    volatilitySpreadBps: ammConfigInputs.volatilitySpreadBps,
    basePythPriceFeedIdBytes: ammConfigInputs.basePythPriceFeedIdBytes,
    quotePythPriceFeedIdBytes: ammConfigInputs.quotePythPriceFeedIdBytes,
    orderExpirationTimeMs: ammConfigInputs.orderExpirationTimeMs,
    maxPriceAgeSecs: ammConfigInputs.maxPriceAgeSecs,
    maxConfRatioBps: ammConfigInputs.maxConfRatioBps,
    outerBalanceBps: ammConfigInputs.outerBalanceBps
  })

  const { execution, summary } = await tooling.executeTransactionWithSummary({
    transaction: createExecutorTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: "create-amm"
  })

  if (!execution) {
    throw new Error("AMM config creation did not execute.")
  }

  const ammConfigId = requireCreatedArtifactIdBySuffix({
    createdArtifacts: execution.objectArtifacts.created,
    suffix: EXECUTOR_TYPE_SUFFIX,
    label: "AMM market maker"
  })

  const adminCapId = requireCreatedArtifactIdBySuffix({
    createdArtifacts: execution.objectArtifacts.created,
    suffix: AMM_ADMIN_CAP_TYPE_SUFFIX,
    label: "AMM admin cap"
  })

  return {
    ammConfigSnapshot: await collectAmmConfigSnapshot({
      tooling,
      ammConfigId
    }),
    adminCapId,
    transactionSummary: summary
  }
}

export const createAmmConfigSnapshotFromArgs = async ({
  tooling,
  ammPackageId,
  poolId,
  basePythPriceFeedIdHex,
  quotePythPriceFeedIdHex,
  baseSpreadBps,
  volatilitySpreadBps,
  orderExpirationTimeMs,
  maxPriceAgeSecs,
  maxConfRatioBps,
  outerBalanceBps
}: {
  tooling: Tooling
  ammPackageId: string
  poolId: string
  basePythPriceFeedIdHex: string
  quotePythPriceFeedIdHex: string
  baseSpreadBps?: string
  volatilitySpreadBps?: string
  orderExpirationTimeMs?: string
  maxPriceAgeSecs?: string
  maxConfRatioBps?: string
  outerBalanceBps?: string
}): Promise<{
  ammConfigSnapshot: AmmConfigSnapshot
  adminCapId: string
  basePythPriceFeedIdHex: string
  quotePythPriceFeedIdHex: string
  transactionSummary?: { label?: string }
}> => {
  const ammConfigInputs = resolveAmmConfigInputs({
    basePythPriceFeedIdHex,
    quotePythPriceFeedIdHex,
    volatilitySpreadBps,
    baseSpreadBps,
    orderExpirationTimeMs,
    maxPriceAgeSecs,
    maxConfRatioBps,
    outerBalanceBps
  })

  const createdAmmConfig = await createAmmConfigSnapshot({
    tooling,
    ammPackageId,
    poolId,
    ammConfigInputs
  })

  return {
    ...createdAmmConfig,
    basePythPriceFeedIdHex: ammConfigInputs.basePythPriceFeedIdHex,
    quotePythPriceFeedIdHex: ammConfigInputs.quotePythPriceFeedIdHex
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
