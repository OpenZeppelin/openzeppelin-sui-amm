import type { SuiClient } from "@mysten/sui/client"
import {
  AMM_ADMIN_CAP_STORE_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import { findMockPriceFeedConfig } from "@sui-amm/domain-core/models/pyth"
import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
import {
  findLatestArtifactThat,
  loadDeploymentArtifacts,
  readArtifact
} from "@sui-amm/tooling-node/artifacts"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { logKeyValueGreen, logWarning } from "@sui-amm/tooling-node/log"
import { resolveFullPackagePath } from "@sui-amm/tooling-node/move"
import type { MockArtifact } from "./mocks.ts"
import { mockArtifactPath } from "./mocks.ts"

export const DEFAULT_PYTH_PRICE_FEED_LABEL = "MOCK_SUI_FEED"

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

  if (!publishArtifact?.digest)
    throw new Error(
      "Unable to locate the latest AMM publish artifact; provide --admin-cap-id or re-run publish to refresh deployments."
    )

  return resolveAmmAdminCapStoreIdFromPublishDigest({
    publishDigest: publishArtifact.digest,
    suiClient: tooling.suiClient
  })
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
