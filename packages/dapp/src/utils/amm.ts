import type { SuiClient } from "@mysten/sui/client"
import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
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

  if (!publishArtifact?.digest) {
    throw new Error(
      "Unable to locate the latest AMM publish artifact; provide --admin-cap-id or re-run publish to refresh deployments."
    )
  }

  return resolveAmmAdminCapIdFromPublishDigest({
    publishDigest: publishArtifact.digest,
    suiClient: tooling.suiClient
  })
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
  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})

  return findPriceFeedIdFromMockArtifact(mockArtifact, desiredLabel)
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
