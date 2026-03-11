import path from "node:path"

import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import type { ObjectArtifact } from "@sui-amm/tooling-core/object"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import {
  findLatestArtifactThat,
  loadDeploymentArtifacts,
  loadObjectArtifacts,
  readArtifact
} from "@sui-amm/tooling-node/artifacts"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { logKeyValueGreen, logWarning } from "@sui-amm/tooling-node/log"
import {
  resolveFullPackagePath,
  syncMoveTomlDependencyReplacementEntry,
  syncMoveTomlDependencyPublishedIds
} from "@sui-amm/tooling-node/move"
import type { MockArtifact } from "./mocks.ts"
import { mockArtifactPath } from "./mocks.ts"

export const DEFAULT_PYTH_PRICE_FEED_LABEL = "MOCK_SUI_FEED"
export const DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID =
  "0x1111111111111111111111111111111111111111111111111111111111111111"

const AMM_DEEPBOOK_DEPENDENCY_NAME = "deepbook"
const AMM_PACKAGE_FOLDER_NAME = "prop-amm"

export const resolveAmmPackagePath = (tooling: Pick<Tooling, "suiConfig">) =>
  resolveFullPackagePath(tooling.suiConfig.paths.move, AMM_PACKAGE_FOLDER_NAME)

export const syncAmmDeepbookDependencyPublishedIds = async ({
  tooling,
  environmentName,
  deepbookPublishedAt,
  deepbookOriginalId
}: {
  tooling: Pick<Tooling, "suiConfig">
  environmentName: string
  deepbookPublishedAt: string
  deepbookOriginalId: string
}) => {
  const ammPackagePath = resolveAmmPackagePath(tooling)
  const moveTomlPath = path.join(ammPackagePath, "Move.toml")

  return await syncMoveTomlDependencyPublishedIds({
    moveTomlPath,
    environmentName,
    dependencyName: AMM_DEEPBOOK_DEPENDENCY_NAME,
    publishedAt: deepbookPublishedAt,
    originalId: deepbookOriginalId
  })
}

export const syncAmmDeepbookDependencyLocalReplacement = async ({
  tooling,
  environmentName,
  deepbookContractPath
}: {
  tooling: Pick<Tooling, "suiConfig">
  environmentName: string
  deepbookContractPath: string
}) => {
  const ammPackagePath = resolveAmmPackagePath(tooling)
  const moveTomlPath = path.join(ammPackagePath, "Move.toml")
  const relativeDeepbookPath = path.relative(
    ammPackagePath,
    deepbookContractPath
  )
  const normalizedDeepbookPath = relativeDeepbookPath.startsWith(".")
    ? relativeDeepbookPath
    : `./${relativeDeepbookPath}`

  return await syncMoveTomlDependencyReplacementEntry({
    moveTomlPath,
    environmentName,
    dependencyName: AMM_DEEPBOOK_DEPENDENCY_NAME,
    replacementEntry: `${AMM_DEEPBOOK_DEPENDENCY_NAME} = { local = "${normalizedDeepbookPath}", override = true }`
  })
}

const resolveAmmPublishArtifact = async ({
  networkName,
  ammPackageId
}: {
  networkName: string
  ammPackageId: string
}): Promise<PublishArtifact | undefined> => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)

  return findLatestArtifactThat(
    (artifact) => artifact.packageId === ammPackageId,
    deploymentArtifacts
  )
}

const isAmmAdminCapArtifact = (artifact: ObjectArtifact) =>
  artifact.objectType?.endsWith(AMM_ADMIN_CAP_TYPE_SUFFIX)

const findLatestAmmAdminCapArtifact = ({
  objectArtifacts,
  predicate
}: {
  objectArtifacts: ObjectArtifact[]
  predicate: (artifact: ObjectArtifact) => boolean
}) =>
  objectArtifacts.reduceRight<ObjectArtifact | undefined>(
    (latest, artifact) => {
      if (latest) return latest
      if (!isAmmAdminCapArtifact(artifact)) return undefined
      return predicate(artifact) ? artifact : undefined
    },
    undefined
  )

const resolveAmmAdminCapIdFromObjectArtifacts = async ({
  networkName,
  publishDigest,
  ammPackageId
}: {
  networkName: string
  publishDigest?: string
  ammPackageId: string
}): Promise<string | undefined> => {
  const objectArtifacts = await loadObjectArtifacts(networkName)
  const normalizedPackageId = normalizeSuiObjectId(ammPackageId)

  const adminCapFromPublishDigest = publishDigest
    ? findLatestAmmAdminCapArtifact({
        objectArtifacts,
        predicate: (artifact) => artifact.digest === publishDigest
      })
    : undefined

  if (adminCapFromPublishDigest?.objectId) {
    return adminCapFromPublishDigest.objectId
  }

  return findLatestAmmAdminCapArtifact({
    objectArtifacts,
    predicate: (artifact) => artifact.packageId === normalizedPackageId
  })?.objectId
}

const createAdminCapResolutionError = () =>
  new Error(
    "Unable to resolve the AMM admin cap from the latest publish transaction or object artifacts; provide --admin-cap-id or re-run publish to refresh deployments."
  )

export const resolveAmmAdminCapIdFromPublishDigest = async ({
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

  return ensureCreatedObject(AMM_ADMIN_CAP_TYPE_SUFFIX, publishTransaction)
    .objectId
}

export const resolveAmmAdminCapIdFromArtifacts = async ({
  tooling,
  ammPackageId
}: {
  tooling: Pick<Tooling, "suiClient" | "network">
  ammPackageId: string
}): Promise<string> => {
  const publishArtifact = await resolveAmmPublishArtifact({
    networkName: tooling.network.networkName,
    ammPackageId
  })

  const adminCapIdFromObjectArtifacts =
    await resolveAmmAdminCapIdFromObjectArtifacts({
      networkName: tooling.network.networkName,
      publishDigest: publishArtifact?.digest,
      ammPackageId
    })

  if (adminCapIdFromObjectArtifacts) {
    return adminCapIdFromObjectArtifacts
  }

  if (!publishArtifact?.digest) {
    throw createAdminCapResolutionError()
  }

  try {
    return await resolveAmmAdminCapIdFromPublishDigest({
      publishDigest: publishArtifact.digest,
      suiClient: tooling.suiClient
    })
  } catch (error) {
    logWarning(
      `Unable to recover the AMM admin cap from publish digest ${publishArtifact.digest}: ${error instanceof Error ? error.message : String(error)}`
    )
    throw createAdminCapResolutionError()
  }
}

const findPriceFeedIdFromMockArtifact = (
  mockArtifact: MockArtifact,
  label: string
): string | undefined =>
  mockArtifact.priceFeeds?.find((priceFeed) => priceFeed.label === label)
    ?.feedIdHex

const resolveLocalnetFeedIdFromArtifacts = async ({
  desiredLabel
}: {
  desiredLabel: string
}) => {
  try {
    const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})

    return findPriceFeedIdFromMockArtifact(mockArtifact, desiredLabel)
  } catch {
    return undefined
  }
}

const logLocalnetPlaceholderFeedIdFallback = (desiredLabel: string) => {
  logWarning(
    `No localnet feed artifact found for ${desiredLabel}; using a deterministic placeholder feed id.`
  )
}

const resolveLocalnetPythPriceFeedIdHex = async ({
  pythPriceFeedLabel
}: {
  pythPriceFeedLabel?: string
}): Promise<string> => {
  const desiredLabel = pythPriceFeedLabel ?? DEFAULT_PYTH_PRICE_FEED_LABEL
  const artifactFeedId = await resolveLocalnetFeedIdFromArtifacts({
    desiredLabel
  })

  if (artifactFeedId) {
    return artifactFeedId
  }

  logLocalnetPlaceholderFeedIdFallback(desiredLabel)

  return DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID
}

export const resolvePythPriceFeedIdHex = async ({
  networkName,
  pythPriceFeedId,
  pythPriceFeedLabel
}: {
  networkName: string
  pythPriceFeedId?: string
  pythPriceFeedLabel?: string
}): Promise<string> => {
  const trimmedPythPriceFeedId = pythPriceFeedId?.trim()
  if (trimmedPythPriceFeedId) {
    return trimmedPythPriceFeedId
  }

  if (networkName !== "localnet") {
    throw new Error(
      "Pyth price feed id is required; provide --pyth-price-feed-id when targeting shared networks."
    )
  }

  return resolveLocalnetPythPriceFeedIdHex({ pythPriceFeedLabel })
}

export const logAmmConfigOverview = (
  overview: AmmConfigOverview,
  options?: {
    initialSharedVersion?: string
  }
) => {
  logKeyValueGreen("Config")(overview.configId)
  logKeyValueGreen("Spread-bps")(overview.baseSpreadBps)
  logKeyValueGreen("Vol-bps")(overview.volatilityMultiplierBps)
  logKeyValueGreen("Use-laser")(overview.useLaser ? "Yes" : "No")
  logKeyValueGreen("Paused")(overview.tradingPaused ? "Yes" : "No")
  logKeyValueGreen("Feed-id")(overview.pythPriceFeedIdHex)
  if (options?.initialSharedVersion) {
    logKeyValueGreen("Shared-ver")(options.initialSharedVersion)
  }

  console.log("")
}
