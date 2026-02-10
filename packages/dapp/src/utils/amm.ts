import path from "node:path"

import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import { findMockPriceFeedConfig } from "@sui-amm/domain-core/models/pyth"
import { buildClaimAmmAdminCapTransaction } from "@sui-amm/domain-core/ptb/amm"
import {
  resolveAmmAdminCapStoreId,
  resolveOwnedAmmAdminCapId
} from "@sui-amm/domain-node/amm"
import { normalizeIdOrThrow } from "@sui-amm/tooling-core/object"
import { resolveSignerAddress } from "@sui-amm/tooling-node/account"
import { readArtifact } from "@sui-amm/tooling-node/artifacts"
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

const findPriceFeedIdFromMockArtifact = (
  mockArtifact: MockArtifact,
  label: string
): string | undefined =>
  mockArtifact.priceFeeds?.find((feed) => feed.label === label)?.feedIdHex

export const resolvePythPriceFeedIdHex = async ({
  networkName,
  pythPriceFeedId,
  pythPriceFeedLabel
}: {
  networkName: string
  pythPriceFeedId?: string
  pythPriceFeedLabel?: string
}): Promise<string> => {
  const trimmedFeedId = pythPriceFeedId?.trim()
  if (trimmedFeedId) return trimmedFeedId

  if (networkName !== "localnet")
    throw new Error(
      "Pyth price feed id is required; provide --pyth-price-feed-id when targeting shared networks."
    )

  const desiredLabel = pythPriceFeedLabel ?? DEFAULT_PYTH_PRICE_FEED_LABEL
  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})

  const artifactFeedId = findPriceFeedIdFromMockArtifact(
    mockArtifact,
    desiredLabel
  )
  if (artifactFeedId) return artifactFeedId

  const fallbackFeed = findMockPriceFeedConfig({ label: desiredLabel })
  if (fallbackFeed) {
    logWarning(
      `No localnet mock feed artifacts found for ${desiredLabel}; using default mock feed id.`
    )
    return fallbackFeed.feedIdHex
  }

  throw new Error(
    "Unable to resolve a Pyth price feed id. Run the mock setup script or provide --pyth-price-feed-id."
  )
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
  if (options?.initialSharedVersion)
    logKeyValueGreen("Shared-ver")(options.initialSharedVersion)
  console.log("")
}
