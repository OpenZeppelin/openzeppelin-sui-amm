import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import {
  resolveAmmAdminCapStoreId,
  resolveOwnedAmmAdminCapId
} from "@sui-amm/domain-node/amm"
import {
  normalizeIdOrThrow,
  type ObjectArtifact
} from "@sui-amm/tooling-core/object"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import { resolveSignerAddress } from "@sui-amm/tooling-node/account"
import {
  findLatestArtifactThat,
  loadDeploymentArtifacts,
  loadObjectArtifacts,
  readArtifact
} from "@sui-amm/tooling-node/artifacts"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { logKeyValueGreen, logWarning } from "@sui-amm/tooling-node/log"
import { resolveFullPackagePath } from "@sui-amm/tooling-node/move"
import type { MockArtifact } from "./mocks.ts"
import { mockArtifactPath } from "./mocks.ts"
import { buildClaimAmmAdminCapTransaction } from "@sui-amm/domain-core/ptb/amm"

export const DEFAULT_PYTH_PRICE_FEED_LABEL = "MOCK_SUI_FEED"
export const DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID =
  "0x1111111111111111111111111111111111111111111111111111111111111111"

const AMM_PACKAGE_FOLDER_NAME = "prop-amm"

export const resolveAmmPackagePath = (tooling: Tooling) =>
  resolveFullPackagePath(tooling.suiConfig.paths.move, AMM_PACKAGE_FOLDER_NAME)

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

export const claimAmmAdminCapFromStore = async ({
  tooling,
  ammPackageId,
  adminCapStoreId,
  devInspect,
  summaryLabel = "claim-amm-admin-cap"
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
  >
  ammPackageId: string
  adminCapStoreId: string
  devInspect?: boolean
  summaryLabel?: string
}) => {
  const adminCapStore = await tooling.getMutableSharedObject({
    objectId: adminCapStoreId
  })
  const claimTransaction = buildClaimAmmAdminCapTransaction({
    packageId: ammPackageId,
    adminCapStore
  })

  return await tooling.executeTransactionWithSummary({
    transaction: claimTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel,
    devInspect
  })
}

export const resolveAmmAdminCapIdOrClaim = async ({
  tooling,
  ammPackageId,
  adminCapId,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
    | "network"
    | "suiClient"
  >
  ammPackageId: string
  adminCapId?: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<string> => {
  const trimmedAdminCapId = adminCapId?.trim()
  if (trimmedAdminCapId)
    return normalizeIdOrThrow(
      trimmedAdminCapId,
      "AMM admin cap id is required; provide --admin-cap-id."
    )

  const ownerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)

  const ownedAdminCapId = await resolveOwnedAmmAdminCapId({
    ammPackageId,
    ownerAddress,
    suiClient: tooling.suiClient
  })
  if (ownedAdminCapId) return ownedAdminCapId

  if (dryRun)
    throw new Error(
      "AMM admin cap id is required in --dry-run mode. Provide --admin-cap-id or run without --dry-run to claim from the admin cap store."
    )

  const adminCapStoreId = await resolveAmmAdminCapStoreId({
    networkName: tooling.network.networkName,
    ammPackageId,
    suiClient: tooling.suiClient
  })
  await claimAmmAdminCapFromStore({
    tooling,
    ammPackageId,
    adminCapStoreId,
    devInspect
  })

  const claimedAdminCapId = await resolveOwnedAmmAdminCapId({
    suiClient: tooling.suiClient,
    ammPackageId,
    ownerAddress
  })
  if (!claimedAdminCapId)
    throw new Error(
      "Unable to resolve the AMM admin cap after claiming; provide --admin-cap-id and retry."
    )

  return claimedAdminCapId
}
