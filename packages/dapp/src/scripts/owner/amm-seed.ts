/**
 * Seeds the AMM package and config for the target network.
 */
import yargs from "yargs"

import { normalizeSuiObjectId } from "@mysten/sui/utils"

import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import {
  AMM_CONFIG_TYPE_SUFFIX,
  DEFAULT_BASE_SPREAD_BPS,
  DEFAULT_VOLATILITY_MULTIPLIER_BPS,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildCreateAmmConfigTransaction } from "@sui-amm/domain-core/ptb/amm"
import {
  collectAmmConfigSnapshot,
  isAmmPublishArtifact,
  type AmmConfigSnapshot
} from "@sui-amm/domain-node/amm"
import { normalizeIdOrThrow } from "@sui-amm/tooling-core/object"
import {
  findLatestArtifactThat,
  loadDeploymentArtifacts,
  loadObjectArtifacts
} from "@sui-amm/tooling-node/artifacts"
import { withMutedConsole } from "@sui-amm/tooling-node/console"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import {
  logKeyValueBlue,
  logKeyValueYellow,
  logWarning
} from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { waitForObjectState } from "@sui-amm/tooling-node/testing/objects"
import { requireCreatedArtifactIdBySuffix } from "@sui-amm/tooling-node/transactions"
import {
  logAmmConfigOverview,
  resolveAmmPackagePath,
  resolvePythPriceFeedIdHex
} from "../../utils/amm.ts"

type AmmSeedArguments = {
  baseSpreadBps?: string
  volatilityMultiplierBps?: string
  useLaser?: boolean
  pythPriceFeedId?: string
  pythPriceFeedLabel?: string
  ammPackageId?: string
  rePublish?: boolean
  useCliPublish?: boolean
  json?: boolean
}

type AmmSeedOutput = {
  ammPackageId: string
  ammConfigId: string
  ammConfig: AmmConfigOverview
  initialSharedVersion: string
  pythPriceFeedIdHex: string
  publishDigest?: string
  transactionSummary?: { label?: string }
  didPublish: boolean
  didCreateAmmConfig: boolean
}

const waitForPackageAvailability = async (
  packageId: string,
  tooling: Pick<Tooling, "suiClient" | "network">
) => {
  if (tooling.network.networkName !== "localnet") return

  await waitForObjectState({
    suiClient: tooling.suiClient,
    objectId: packageId,
    label: "AMM package",
    objectOptions: { showType: true, showContent: true },
    predicate: (response) => response.data?.content?.dataType === "package"
  })
}

const doesObjectExist = async ({
  tooling,
  objectId
}: {
  tooling: Pick<Tooling, "getObjectSafe">
  objectId: string
}): Promise<boolean> => {
  const response = await tooling.getObjectSafe({ objectId })
  return Boolean(response?.data)
}

const resolveAmmPackageIdFromCli = async ({
  ammPackageId,
  rePublish,
  tooling
}: {
  ammPackageId?: string
  rePublish?: boolean
  tooling: Pick<Tooling, "getObjectSafe">
}): Promise<string | undefined> => {
  if (rePublish && ammPackageId)
    throw new Error(
      "Cannot combine --re-publish with --amm-package-id; omit the package id to republish."
    )
  if (!ammPackageId) return undefined

  const normalizedPackageId = normalizeIdOrThrow(
    ammPackageId,
    "AMM package id is required."
  )

  const existsOnChain = await doesObjectExist({
    tooling,
    objectId: normalizedPackageId
  })
  if (!existsOnChain)
    throw new Error(
      `AMM package ${normalizedPackageId} was not found on the target network.`
    )

  return normalizedPackageId
}

const resolveLatestAmmPublishArtifact = async (networkName: string) => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)
  return findLatestArtifactThat(isAmmPublishArtifact, deploymentArtifacts)
}

const resolveExistingAmmPackageId = async ({
  tooling,
  networkName
}: {
  tooling: Pick<Tooling, "getObjectSafe">
  networkName: string
}): Promise<string | undefined> => {
  const latestArtifact = await resolveLatestAmmPublishArtifact(networkName)
  const artifactPackageId = latestArtifact?.packageId
  if (!artifactPackageId) return undefined

  const normalizedPackageId = normalizeSuiObjectId(artifactPackageId)
  const existsOnChain = await doesObjectExist({
    tooling,
    objectId: normalizedPackageId
  })
  if (existsOnChain) return normalizedPackageId

  logWarning(
    "Deployment artifact exists but the package object was not found on the target network. Republish will proceed."
  )
  logKeyValueBlue("artifactPackageId")(normalizedPackageId)
  logKeyValueBlue("network")(networkName)

  return undefined
}

const publishAmmPackage = async ({
  tooling,
  rePublish,
  useCliPublish
}: {
  tooling: Tooling
  rePublish?: boolean
  useCliPublish?: boolean
}) => {
  const targetingLocalnet = tooling.network.networkName === "localnet"
  const shouldUseCliPublish = useCliPublish ?? !targetingLocalnet

  logKeyValueBlue("Package")("Publishing AMM package.")

  return tooling.publishMovePackageWithFunding({
    packagePath: resolveAmmPackagePath(tooling),
    withUnpublishedDependencies: targetingLocalnet,
    allowAutoUnpublishedDependencies: targetingLocalnet,
    clearPublishedEntry: Boolean(rePublish),
    useCliPublish: shouldUseCliPublish
  })
}

const resolveOrPublishAmmPackageId = async ({
  tooling,
  cliArguments
}: {
  tooling: Tooling
  cliArguments: AmmSeedArguments
}): Promise<{
  ammPackageId: string
  publishDigest?: string
  didPublish: boolean
}> => {
  const packageIdFromCli = await resolveAmmPackageIdFromCli({
    ammPackageId: cliArguments.ammPackageId,
    rePublish: cliArguments.rePublish,
    tooling
  })
  if (packageIdFromCli)
    return { ammPackageId: packageIdFromCli, didPublish: false }

  if (!cliArguments.rePublish) {
    const existingPackageId = await resolveExistingAmmPackageId({
      tooling,
      networkName: tooling.network.networkName
    })
    if (existingPackageId)
      return { ammPackageId: existingPackageId, didPublish: false }
  } else {
    logKeyValueYellow("Package")("Re-publish requested; forcing publish.")
  }

  const publishArtifact = await publishAmmPackage({
    tooling,
    rePublish: cliArguments.rePublish,
    useCliPublish: cliArguments.useCliPublish
  })

  return {
    ammPackageId: normalizeSuiObjectId(publishArtifact.packageId),
    publishDigest: publishArtifact.digest,
    didPublish: true
  }
}

const resolveExistingAmmConfigId = async ({
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

  for (let index = objectArtifacts.length - 1; index >= 0; index -= 1) {
    const artifact = objectArtifacts[index]
    if (!artifact?.objectType?.endsWith(AMM_CONFIG_TYPE_SUFFIX)) continue
    if (normalizeSuiObjectId(artifact.packageId) !== normalizedPackageId)
      continue

    const normalizedObjectId = normalizeSuiObjectId(artifact.objectId)
    const existsOnChain = await doesObjectExist({
      tooling,
      objectId: normalizedObjectId
    })
    if (!existsOnChain) continue

    return normalizedObjectId
  }

  return undefined
}

const createAmmConfigSnapshot = async ({
  tooling,
  cliArguments,
  ammPackageId
}: {
  tooling: Tooling
  cliArguments: AmmSeedArguments
  ammPackageId: string
}) => {
  const pythPriceFeedIdHex = await resolvePythPriceFeedIdHex({
    networkName: tooling.network.networkName,
    pythPriceFeedId: cliArguments.pythPriceFeedId,
    pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
  })

  const ammConfigInputs = await resolveAmmConfigInputs({
    pythPriceFeedIdHex,
    volatilityMultiplierBps: cliArguments.volatilityMultiplierBps,
    baseSpreadBps: cliArguments.baseSpreadBps,
    useLaser: cliArguments.useLaser
  })

  const createAmmTransaction = buildCreateAmmConfigTransaction({
    packageId: ammPackageId,
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

  if (!execution) throw new Error("AMM config creation did not execute.")

  const createdArtifacts = execution.objectArtifacts.created
  const ammConfigId = requireCreatedArtifactIdBySuffix({
    createdArtifacts,
    suffix: AMM_CONFIG_TYPE_SUFFIX,
    label: "AMM config"
  })

  return {
    ammConfigSnapshot: await collectAmmConfigSnapshot({
      tooling,
      ammConfigId
    }),
    pythPriceFeedIdHex: ammConfigInputs.pythPriceFeedIdHex,
    transactionSummary: summary
  }
}

const resolveOrCreateAmmConfigSnapshot = async ({
  tooling,
  cliArguments,
  ammPackageId
}: {
  tooling: Tooling
  cliArguments: AmmSeedArguments
  ammPackageId: string
}): Promise<{
  ammConfigSnapshot: AmmConfigSnapshot
  pythPriceFeedIdHex?: string
  transactionSummary?: { label?: string }
  didCreate: boolean
}> => {
  const existingConfigId = await resolveExistingAmmConfigId({
    tooling,
    networkName: tooling.network.networkName,
    ammPackageId
  })

  if (existingConfigId) {
    logKeyValueYellow("Config")("Using existing AMM config.")

    return {
      ammConfigSnapshot: await collectAmmConfigSnapshot({
        tooling,
        ammConfigId: existingConfigId
      }),
      didCreate: false
    }
  }

  logKeyValueBlue("Config")("Creating AMM config.")

  const createdConfig = await createAmmConfigSnapshot({
    tooling,
    cliArguments,
    ammPackageId
  })

  return {
    ...createdConfig,
    didCreate: true
  }
}

runSuiScript(
  async (tooling, cliArguments: AmmSeedArguments) => {
    const seedAmm = async (): Promise<AmmSeedOutput> => {
      const { ammPackageId, publishDigest, didPublish } =
        await resolveOrPublishAmmPackageId({
          tooling,
          cliArguments
        })

      if (didPublish) {
        await waitForPackageAvailability(ammPackageId, tooling)
      }

      const {
        ammConfigSnapshot,
        pythPriceFeedIdHex,
        transactionSummary,
        didCreate
      } = await resolveOrCreateAmmConfigSnapshot({
        tooling,
        cliArguments,
        ammPackageId
      })

      logAmmConfigOverview(ammConfigSnapshot.ammConfigOverview, {
        initialSharedVersion: ammConfigSnapshot.initialSharedVersion
      })

      return {
        ammPackageId,
        ammConfigId: ammConfigSnapshot.ammConfigOverview.configId,
        ammConfig: ammConfigSnapshot.ammConfigOverview,
        initialSharedVersion: ammConfigSnapshot.initialSharedVersion,
        pythPriceFeedIdHex:
          pythPriceFeedIdHex ??
          ammConfigSnapshot.ammConfigOverview.pythPriceFeedIdHex,
        publishDigest,
        transactionSummary,
        didPublish,
        didCreateAmmConfig: didCreate
      }
    }

    const seedResult = cliArguments.json
      ? await withMutedConsole(seedAmm)
      : await seedAmm()

    if (emitJsonOutput(seedResult, cliArguments.json)) return
  },
  yargs()
    .option("baseSpreadBps", {
      alias: ["base-spread-bps"],
      type: "string",
      description: "Base spread in basis points (u64).",
      default: DEFAULT_BASE_SPREAD_BPS,
      demandOption: false
    })
    .option("volatilityMultiplierBps", {
      alias: ["volatility-multiplier-bps"],
      type: "string",
      description: "Volatility multiplier in basis points (u64).",
      default: DEFAULT_VOLATILITY_MULTIPLIER_BPS,
      demandOption: false
    })
    .option("useLaser", {
      alias: ["use-laser"],
      type: "boolean",
      default: false,
      description: "Enable the laser pricing path for the AMM."
    })
    .option("pythPriceFeedId", {
      alias: ["pyth-price-feed-id", "pyth-feed-id"],
      type: "string",
      description: "Pyth price feed id (32 bytes hex).",
      demandOption: false
    })
    .option("pythPriceFeedLabel", {
      alias: ["pyth-price-feed-label", "pyth-feed-label"],
      type: "string",
      description:
        "Localnet mock feed label to resolve the feed id when --pyth-price-feed-id is omitted.",
      demandOption: false
    })
    .option("ammPackageId", {
      alias: ["amm-package-id"],
      type: "string",
      description:
        "Package ID for the PropAmm Move package; inferred from the latest publish entry when omitted.",
      demandOption: false
    })
    .option("rePublish", {
      alias: ["re-publish"],
      type: "boolean",
      description:
        "Re-publish the PropAmm Move package even if an existing deployment artifact is present.",
      default: false
    })
    .option("useCliPublish", {
      alias: "use-cli-publish",
      type: "boolean",
      description:
        "Publish with the Sui CLI instead of the SDK (use --no-use-cli-publish to force SDK).",
      default: undefined
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)
