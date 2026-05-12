import path from "node:path"

import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import {
  AMM_DEEPBOOK_DEPENDENCY_NAME,
  AMM_PACKAGE_FOLDER_NAME,
  resolveAmmAdminCapId as resolveExplicitAmmAdminCapId,
  resolveOwnedAmmAdminCapId
} from "@sui-amm/domain-node/amm"
import type { ObjectArtifact } from "@sui-amm/tooling-core/object"
import {
  loadObjectArtifacts,
  readArtifact
} from "@sui-amm/tooling-node/artifacts"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { logKeyValueGreen, logWarning } from "@sui-amm/tooling-node/log"
import {
  resolveFullPackagePath,
  syncMoveTomlDependencyPublishedIds
} from "@sui-amm/tooling-node/move"
import type { MockArtifact } from "./mocks.ts"
import { mockArtifactPath } from "./mocks.ts"

export const DEFAULT_PYTH_PRICE_FEED_LABEL = "MOCK_SUI_FEED"
export const DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID =
  "0x1111111111111111111111111111111111111111111111111111111111111111"

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

const isAmmAdminCapArtifact = (artifact: ObjectArtifact) =>
  artifact.objectType?.endsWith(AMM_ADMIN_CAP_TYPE_SUFFIX)

const resolveAmmAdminCapIdFromObjectArtifacts = async ({
  networkName,
  ammPackageId
}: {
  networkName: string
  ammPackageId: string
}): Promise<string | undefined> => {
  const objectArtifacts = await loadObjectArtifacts(networkName)
  const normalizedPackageId = normalizeSuiObjectId(ammPackageId)

  return objectArtifacts.reduceRight<ObjectArtifact | undefined>(
    (latest, artifact) => {
      if (latest) return latest
      if (!isAmmAdminCapArtifact(artifact)) return undefined
      return normalizeSuiObjectId(artifact.packageId) === normalizedPackageId
        ? artifact
        : undefined
    },
    undefined
  )?.objectId
}

const createAdminCapResolutionError = () =>
  new Error(
    "Unable to resolve the AMM admin cap from object artifacts; provide --admin-cap-id or re-run amm-create to refresh deployments."
  )

const buildMissingSignerAdminCapError = ({
  signerAddress,
  ammPackageId
}: {
  signerAddress: string
  ammPackageId: string
}) =>
  new Error(
    `No AMM admin capability found for signer ${signerAddress}. Provide --admin-cap-id or use a signer that owns ${normalizeSuiObjectId(ammPackageId)}${AMM_ADMIN_CAP_TYPE_SUFFIX}.`
  )

export const resolveSignerAmmAdminCapId = async ({
  tooling,
  ammPackageId,
  signerAddress,
  adminCapId
}: {
  tooling: Pick<Tooling, "network" | "suiClient">
  ammPackageId: string
  signerAddress: string
  adminCapId?: string
}): Promise<string> => {
  const trimmedAdminCapId = adminCapId?.trim()
  if (trimmedAdminCapId) {
    return resolveExplicitAmmAdminCapId({
      networkName: tooling.network.networkName,
      adminCapId: trimmedAdminCapId
    })
  }

  const ownedAdminCapId = await resolveOwnedAmmAdminCapId({
    ammPackageId,
    ownerAddress: signerAddress,
    suiClient: tooling.suiClient
  })
  if (ownedAdminCapId) {
    return ownedAdminCapId
  }

  throw buildMissingSignerAdminCapError({ signerAddress, ammPackageId })
}

export const resolveAmmAdminCapIdFromArtifacts = async ({
  tooling,
  ammPackageId
}: {
  tooling: Pick<Tooling, "network">
  ammPackageId: string
}): Promise<string> => {
  const adminCapIdFromObjectArtifacts =
    await resolveAmmAdminCapIdFromObjectArtifacts({
      networkName: tooling.network.networkName,
      ammPackageId
    })

  if (adminCapIdFromObjectArtifacts) {
    return adminCapIdFromObjectArtifacts
  }

  throw createAdminCapResolutionError()
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
  logKeyValueGreen("Vol-mult-bps")(overview.volatilityMultiplierBps)
  logKeyValueGreen("Active")(overview.active ? "Yes" : "No")
  logKeyValueGreen("Base-feed")(overview.basePythPriceFeedIdHex)
  logKeyValueGreen("Quote-feed")(overview.quotePythPriceFeedIdHex)
  logKeyValueGreen("Pool")(overview.poolId)
  logKeyValueGreen("Order-expiry-ms")(overview.orderExpirationTimeMs)
  logKeyValueGreen("Max-age-secs")(overview.maxPriceAgeSecs)
  logKeyValueGreen("Max-conf-bps")(overview.maxConfRatioBps)
  logKeyValueGreen("Outer-balance-bps")(overview.outerBalanceBps)
  logKeyValueGreen("Inv-skew-bps")(overview.inventorySkewBps)
  if (options?.initialSharedVersion) {
    logKeyValueGreen("Shared-ver")(options.initialSharedVersion)
  }

  console.log("")
}
