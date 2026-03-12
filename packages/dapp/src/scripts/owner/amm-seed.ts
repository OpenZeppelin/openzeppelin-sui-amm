/**
 * Seeds the AMM package and config for the target network.
 */
import yargs from "yargs"

import { normalizeSuiObjectId } from "@mysten/sui/utils"

import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import { resolveAmmConfigInputs } from "@sui-amm/domain-core/models/amm"
import {
  type AmmConfigSnapshot,
  collectAmmConfigSnapshot,
  createAmmConfigSnapshotFromArgs,
  resolveExistingAmmConfigIdFromArtifacts
} from "@sui-amm/domain-node/amm"
import { normalizeHex } from "@sui-amm/tooling-core/hex"
import { normalizeIdOrThrow } from "@sui-amm/tooling-core/object"
import { getLatestDeploymentFromArtifact } from "@sui-amm/tooling-node/artifacts"
import { withMutedConsole } from "@sui-amm/tooling-node/console"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import {
  logKeyValueBlue,
  logKeyValueYellow,
  logWarning
} from "@sui-amm/tooling-node/log"
import {
  doesObjectExist,
  waitForPackageAvailability
} from "@sui-amm/tooling-node/objects"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import {
  logAmmConfigOverview,
  resolveAmmAdminCapIdFromArtifacts,
  resolveAmmPackagePath,
  resolvePythPriceFeedIdHex
} from "../../utils/amm.ts"

const AMM_PACKAGE_NAME = "openzeppelin_market_maker"

type AmmSeedArguments = {
  adminCapId?: string
  ammPackageId?: string
  baseSpreadBps?: string
  volatilityMultiplierBps?: string
  useLaser?: boolean
  pythPriceFeedId?: string
  pythPriceFeedLabel?: string
  allowConfigMismatch?: boolean
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

const resolveExplicitPackageId = async ({
  cliArguments,
  tooling
}: {
  cliArguments: AmmSeedArguments
  tooling: Pick<Tooling, "getObjectSafe">
}): Promise<string | undefined> => {
  if (cliArguments.rePublish && cliArguments.ammPackageId) {
    throw new Error(
      "Cannot combine --re-publish with --amm-package-id; omit the package id to republish."
    )
  }

  if (!cliArguments.ammPackageId) {
    return undefined
  }

  const normalizedPackageId = normalizeIdOrThrow(
    cliArguments.ammPackageId,
    "AMM package id is required."
  )
  const packageExists = await doesObjectExist({
    tooling,
    objectId: normalizedPackageId
  })

  if (!packageExists) {
    throw new Error(
      `AMM package ${normalizedPackageId} was not found on the target network.`
    )
  }

  const packageMetadata = await tooling.getObjectSafe({
    objectId: normalizedPackageId,
    options: { showContent: true }
  })

  if (packageMetadata?.data?.content?.dataType !== "package") {
    throw new Error(`AMM package id ${normalizedPackageId} is not a package.`)
  }

  return normalizedPackageId
}

type ResolvedPackageId =
  | { status: "ok"; packageId: string }
  | { status: "stale"; packageId: string }

const resolveExistingPackageId = async ({
  tooling,
  networkName
}: {
  tooling: Pick<Tooling, "getObjectSafe">
  networkName: string
}): Promise<ResolvedPackageId | undefined> => {
  const latestAmmPublishArtifact =
    await getLatestDeploymentFromArtifact(AMM_PACKAGE_NAME)(networkName)
  const packageId = latestAmmPublishArtifact?.packageId

  if (!packageId) {
    return undefined
  }

  const normalizedPackageId = normalizeSuiObjectId(packageId)
  const packageExists = await doesObjectExist({
    tooling,
    objectId: normalizedPackageId
  })

  if (packageExists) {
    const packageMetadata = await tooling.getObjectSafe({
      objectId: normalizedPackageId,
      options: { showContent: true }
    })

    if (packageMetadata?.data?.content?.dataType === "package") {
      return { status: "ok", packageId: normalizedPackageId }
    }
  }

  logWarning(
    "Deployment artifact exists but the package object was not found on the target network. Republish will proceed."
  )
  logKeyValueBlue("artifactPackageId")(normalizedPackageId)
  logKeyValueBlue("network")(networkName)

  return { status: "stale", packageId: normalizedPackageId }
}

const shouldUseCliPublish = ({
  networkName,
  useCliPublish
}: {
  networkName: string
  useCliPublish?: boolean
}) => useCliPublish ?? networkName !== "localnet"

const publishAmmPackage = async ({
  tooling,
  cliArguments,
  clearPublishedEntry
}: {
  tooling: Tooling
  cliArguments: AmmSeedArguments
  clearPublishedEntry: boolean
}) => {
  const targetingLocalnet = tooling.network.networkName === "localnet"

  logKeyValueBlue("Package")("Publishing AMM package.")

  return tooling.publishMovePackageWithFunding({
    packagePath: resolveAmmPackagePath(tooling),
    withUnpublishedDependencies: targetingLocalnet,
    allowAutoUnpublishedDependencies: targetingLocalnet,
    clearPublishedEntry: Boolean(cliArguments.rePublish) || clearPublishedEntry,
    useCliPublish: shouldUseCliPublish({
      networkName: tooling.network.networkName,
      useCliPublish: cliArguments.useCliPublish
    })
  })
}

const resolveOrPublishAmmPackage = async ({
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
  let shouldClearPublishedEntry = false
  const explicitPackageId = await resolveExplicitPackageId({
    cliArguments,
    tooling
  })

  if (explicitPackageId) {
    return {
      ammPackageId: explicitPackageId,
      didPublish: false
    }
  }

  if (!cliArguments.rePublish) {
    const existingPackageId = await resolveExistingPackageId({
      tooling,
      networkName: tooling.network.networkName
    })

    if (existingPackageId?.status === "ok") {
      return {
        ammPackageId: existingPackageId.packageId,
        didPublish: false
      }
    }

    if (existingPackageId?.status === "stale") {
      shouldClearPublishedEntry = true
    }
  } else {
    logKeyValueYellow("Package")("Re-publish requested; forcing publish.")
  }

  const publishArtifact = await publishAmmPackage({
    tooling,
    cliArguments,
    clearPublishedEntry: shouldClearPublishedEntry
  })

  return {
    ammPackageId: normalizeSuiObjectId(publishArtifact.packageId),
    publishDigest: publishArtifact.digest,
    didPublish: true
  }
}

const resolveExplicitAdminCapId = ({
  cliArguments
}: {
  cliArguments: AmmSeedArguments
}): string | undefined => {
  if (cliArguments.rePublish && cliArguments.adminCapId) {
    throw new Error(
      "Cannot combine --re-publish with --admin-cap-id; omit the admin cap id so the fresh publish artifacts are used."
    )
  }

  const trimmedAdminCapId = cliArguments.adminCapId?.trim()
  if (!trimmedAdminCapId) {
    return undefined
  }

  return normalizeIdOrThrow(
    trimmedAdminCapId,
    "An AMM admin cap id is required; publish the package or provide --admin-cap-id."
  )
}

const resolveAdminCapId = async ({
  tooling,
  cliArguments,
  ammPackageId
}: {
  tooling: Pick<Tooling, "network" | "suiClient">
  cliArguments: AmmSeedArguments
  ammPackageId: string
}) => {
  const explicitAdminCapId = resolveExplicitAdminCapId({ cliArguments })
  if (explicitAdminCapId) {
    return explicitAdminCapId
  }

  return resolveAmmAdminCapIdFromArtifacts({
    tooling,
    ammPackageId
  })
}

const shouldResolveExplicitPythPriceFeedId = ({
  cliArguments
}: {
  cliArguments: Pick<AmmSeedArguments, "pythPriceFeedId" | "pythPriceFeedLabel">
}) =>
  Boolean(cliArguments.pythPriceFeedId?.trim()) ||
  Boolean(cliArguments.pythPriceFeedLabel?.trim())

const resolveExpectedPythPriceFeedIdHex = async ({
  networkName,
  cliArguments,
  existingOverview
}: {
  networkName: string
  cliArguments: AmmSeedArguments
  existingOverview?: AmmConfigOverview
}) => {
  if (
    existingOverview &&
    !shouldResolveExplicitPythPriceFeedId({ cliArguments })
  ) {
    return existingOverview.pythPriceFeedIdHex
  }

  return resolvePythPriceFeedIdHex({
    networkName,
    pythPriceFeedId: cliArguments.pythPriceFeedId,
    pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
  })
}

const resolveExpectedExistingAmmConfigInputs = async ({
  networkName,
  cliArguments,
  existingOverview
}: {
  networkName: string
  cliArguments: AmmSeedArguments
  existingOverview: AmmConfigOverview
}) =>
  resolveAmmConfigInputs({
    pythPriceFeedIdHex: await resolveExpectedPythPriceFeedIdHex({
      networkName,
      cliArguments,
      existingOverview
    }),
    volatilityMultiplierBps:
      cliArguments.volatilityMultiplierBps ??
      existingOverview.volatilityMultiplierBps,
    baseSpreadBps: cliArguments.baseSpreadBps ?? existingOverview.baseSpreadBps,
    useLaser: cliArguments.useLaser ?? existingOverview.useLaser
  })

const collectAmmConfigInputMismatches = ({
  existingOverview,
  expectedInputs
}: {
  existingOverview: AmmConfigOverview
  expectedInputs: ReturnType<typeof resolveAmmConfigInputs>
}) => {
  const mismatches: string[] = []
  const expectedBaseSpreadBps = expectedInputs.baseSpreadBps.toString()
  const expectedVolatilityMultiplierBps =
    expectedInputs.volatilityMultiplierBps.toString()

  if (
    normalizeHex(existingOverview.pythPriceFeedIdHex) !==
    normalizeHex(expectedInputs.pythPriceFeedIdHex)
  ) {
    mismatches.push(
      `pythPriceFeedIdHex expected ${expectedInputs.pythPriceFeedIdHex} but got ${existingOverview.pythPriceFeedIdHex}`
    )
  }

  if (existingOverview.baseSpreadBps !== expectedBaseSpreadBps) {
    mismatches.push(
      `baseSpreadBps expected ${expectedBaseSpreadBps} but got ${existingOverview.baseSpreadBps}`
    )
  }

  if (existingOverview.volatilityMultiplierBps !== expectedVolatilityMultiplierBps) {
    mismatches.push(
      `volatilityMultiplierBps expected ${expectedVolatilityMultiplierBps} but got ${existingOverview.volatilityMultiplierBps}`
    )
  }

  if (existingOverview.useLaser !== expectedInputs.useLaser) {
    mismatches.push(
      `useLaser expected ${expectedInputs.useLaser} but got ${existingOverview.useLaser}`
    )
  }

  return mismatches
}

const handleAmmConfigMismatches = ({
  mismatches,
  allowConfigMismatch
}: {
  mismatches: string[]
  allowConfigMismatch?: boolean
}) => {
  if (mismatches.length === 0) {
    return
  }

  if (allowConfigMismatch) {
    logWarning(
      "Existing AMM config does not match the requested seed inputs; reusing it because --allow-config-mismatch was provided."
    )
    mismatches.forEach((mismatch) => {
      logWarning(`- ${mismatch}`)
    })
    return
  }

  throw new Error(
    `Existing AMM config does not match requested seed inputs:\n- ${mismatches.join(
      "\n- "
    )}`
  )
}

const resolveOrCreateAmmConfig = async ({
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
  const existingAmmConfigId = await resolveExistingAmmConfigIdFromArtifacts({
    tooling,
    networkName: tooling.network.networkName,
    ammPackageId
  })

  if (existingAmmConfigId) {
    logKeyValueYellow("Config")("Using existing AMM config.")

    const [ammConfigSnapshot, resolvedAdminCapId] = await Promise.all([
      collectAmmConfigSnapshot({
        tooling,
        ammConfigId: existingAmmConfigId
      }),
      resolveAdminCapId({
        tooling,
        cliArguments,
        ammPackageId
      })
    ])

    const expectedInputs = await resolveExpectedExistingAmmConfigInputs({
      networkName: tooling.network.networkName,
      cliArguments,
      existingOverview: ammConfigSnapshot.ammConfigOverview
    })

    const artifactAdminCapId = await resolveAmmAdminCapIdFromArtifacts({
      tooling,
      ammPackageId
    })

    const existingOverview = ammConfigSnapshot.ammConfigOverview
    const mismatches = collectAmmConfigInputMismatches({
      existingOverview,
      expectedInputs
    })

    if (
      normalizeSuiObjectId(artifactAdminCapId) !==
      normalizeSuiObjectId(resolvedAdminCapId)
    ) {
      mismatches.push(
        `adminCapId expected ${resolvedAdminCapId} but got ${artifactAdminCapId}`
      )
    }

    handleAmmConfigMismatches({
      mismatches,
      allowConfigMismatch: cliArguments.allowConfigMismatch
    })

    return {
      ammConfigSnapshot,
      didCreate: false
    }
  }

  logKeyValueBlue("Config")("Creating AMM config.")

  const adminCapId = await resolveAdminCapId({
    tooling,
    cliArguments,
    ammPackageId
  })
  const pythPriceFeedIdHex = await resolvePythPriceFeedIdHex({
    networkName: tooling.network.networkName,
    pythPriceFeedId: cliArguments.pythPriceFeedId,
    pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
  })
  const createdAmmConfig = await createAmmConfigSnapshotFromArgs({
    tooling,
    ammPackageId,
    adminCapId,
    pythPriceFeedIdHex,
    volatilityMultiplierBps: cliArguments.volatilityMultiplierBps,
    baseSpreadBps: cliArguments.baseSpreadBps,
    useLaser: cliArguments.useLaser
  })

  return {
    ...createdAmmConfig,
    didCreate: true
  }
}

const buildAmmSeedOutput = ({
  ammPackageId,
  publishDigest,
  didPublish,
  didCreateAmmConfig,
  ammConfigSnapshot,
  pythPriceFeedIdHex,
  transactionSummary
}: {
  ammPackageId: string
  publishDigest?: string
  didPublish: boolean
  didCreateAmmConfig: boolean
  ammConfigSnapshot: AmmConfigSnapshot
  pythPriceFeedIdHex?: string
  transactionSummary?: { label?: string }
}): AmmSeedOutput => ({
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
  didCreateAmmConfig
})

runSuiScript(
  async (tooling, cliArguments: AmmSeedArguments) => {
    const seedAmm = async (): Promise<AmmSeedOutput> => {
      const { ammPackageId, publishDigest, didPublish } =
        await resolveOrPublishAmmPackage({
          tooling,
          cliArguments
        })

      if (didPublish) {
        await waitForPackageAvailability({
          packageId: ammPackageId,
          tooling,
          label: "AMM package"
        })
      }

      const {
        ammConfigSnapshot,
        pythPriceFeedIdHex,
        transactionSummary,
        didCreate
      } = await resolveOrCreateAmmConfig({
        tooling,
        cliArguments,
        ammPackageId
      })

      logAmmConfigOverview(ammConfigSnapshot.ammConfigOverview, {
        initialSharedVersion: ammConfigSnapshot.initialSharedVersion
      })

      return buildAmmSeedOutput({
        ammPackageId,
        publishDigest,
        didPublish,
        didCreateAmmConfig: didCreate,
        ammConfigSnapshot,
        pythPriceFeedIdHex,
        transactionSummary
      })
    }

    const seedResult = cliArguments.json
      ? await withMutedConsole(seedAmm)
      : await seedAmm()

    if (emitJsonOutput(seedResult, cliArguments.json)) {
      return
    }
  },
  yargs()
    .option("adminCapId", {
      alias: ["admin-cap-id"],
      type: "string",
      description:
        "Admin cap object id for AMM config creation; inferred from the selected AMM publish when omitted.",
      demandOption: false
    })
    .option("baseSpreadBps", {
      alias: ["base-spread-bps"],
      type: "string",
      description:
        "Base spread in basis points (u64); defaults to the current config value when reusing, otherwise the AMM default.",
      demandOption: false
    })
    .option("volatilityMultiplierBps", {
      alias: ["volatility-multiplier-bps"],
      type: "string",
      description:
        "Volatility multiplier in basis points (u64); defaults to the current config value when reusing, otherwise the AMM default.",
      demandOption: false
    })
    .option("useLaser", {
      alias: ["use-laser"],
      type: "boolean",
      description:
        "Enable the laser pricing path for the AMM; defaults to the current config value when reusing, otherwise false."
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
        "Localnet artifact feed label to resolve the feed id when --pyth-price-feed-id is omitted.",
      demandOption: false
    })
    .option("ammPackageId", {
      alias: ["amm-package-id"],
      type: "string",
      description:
        "Package ID for the AMM Move package; inferred from the latest publish entry when omitted.",
      demandOption: false
    })
    .option("allowConfigMismatch", {
      alias: ["allow-config-mismatch"],
      type: "boolean",
      description:
        "Allow reuse of an existing AMM config even when its settings do not match the provided seed inputs.",
      default: false
    })
    .option("rePublish", {
      alias: ["re-publish"],
      type: "boolean",
      description:
        "Re-publish the AMM Move package even if an existing deployment artifact is present.",
      default: false
    })
    .option("useCliPublish", {
      alias: ["use-cli-publish"],
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
