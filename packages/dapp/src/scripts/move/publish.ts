/**
 * Publishes a Move package and records deployment artifacts (package ID, UpgradeCap, Publisher).
 * Uses test-publish dep-replacements for localnet when configured and can skip if already deployed.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import yargs from "yargs"

import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import {
  getLatestArtifact,
  loadDeploymentArtifacts
} from "@sui-amm/tooling-node/artifacts"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "@sui-amm/tooling-node/constants"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { logKeyValueBlue, logWarning } from "@sui-amm/tooling-node/log"
import {
  canonicalizePackagePath,
  clearPublishedEntryForNetwork,
  hasDeploymentForPackage,
  readMoveTomlDependencyReplacement,
  resolveFullPackagePath
} from "@sui-amm/tooling-node/move"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { DEFAULT_DEEPBOOK_PATH } from "../../utils/mocks.ts"

type ResolvedPublishOptions = {
  withUnpublishedDependencies: boolean
  allowAutoUnpublishedDependencies: boolean
  useCliPublish: boolean
}

// Publishing is a single transaction; requiring 3+ gas coin objects can force an extra
// coin-splitting transaction (and faucet calls) even when the account has enough total SUI.
const PUBLISH_MINIMUM_GAS_COIN_OBJECTS = 2
const MOVE_GIT_LOCK_MAX_AGE_MS = 10 * 60 * 1000
const MOVE_GIT_LOCK_DIR = path.join(os.homedir(), ".move", "git")
const AMM_PACKAGE_NAME = "prop_amm"
const DEEPBOOK_DEPENDENCY_NAME = "deepbook"
const DEEPBOOK_TOKEN_DEPENDENCY_NAME = "token"

const findStaleMoveGitLocks = async (): Promise<string[]> => {
  let entries: string[]
  try {
    entries = await fs.readdir(MOVE_GIT_LOCK_DIR)
  } catch {
    return []
  }

  const lockFiles = entries.filter((entry) => entry.endsWith(".lock"))
  if (!lockFiles.length) return []

  const now = Date.now()
  const staleLocks = await Promise.all(
    lockFiles.map(async (entry) => {
      const filePath = path.join(MOVE_GIT_LOCK_DIR, entry)
      try {
        const stats = await fs.stat(filePath)
        const ageMs = now - stats.mtimeMs
        return ageMs >= MOVE_GIT_LOCK_MAX_AGE_MS ? filePath : undefined
      } catch {
        return undefined
      }
    })
  )

  return staleLocks.filter(Boolean) as string[]
}

const preflightMoveGitLocks = async ({
  clearStaleLocks
}: {
  clearStaleLocks: boolean
}) => {
  const staleLocks = await findStaleMoveGitLocks()
  if (!staleLocks.length) return

  if (clearStaleLocks) {
    await Promise.all(
      staleLocks.map(async (filePath) => {
        try {
          await fs.unlink(filePath)
        } catch {
          return
        }
      })
    )
    logWarning(
      `Removed ${staleLocks.length} stale Move git lock file(s) from ${MOVE_GIT_LOCK_DIR}.`
    )
    return
  }

  logWarning(
    `Detected ${staleLocks.length} stale Move git lock file(s) under ${MOVE_GIT_LOCK_DIR}.`
  )
  logKeyValueBlue("Hint")(
    "Re-run with --clear-stale-move-locks to remove them."
  )
}

const getLatestDeploymentForPackagePath = (
  deploymentArtifacts: PublishArtifact[],
  packagePath: string
): PublishArtifact | undefined => {
  const normalizedTargetPath = canonicalizePackagePath(packagePath)
  const matches = deploymentArtifacts.filter(
    (artifact) =>
      canonicalizePackagePath(artifact.packagePath) === normalizedTargetPath
  )
  return getLatestArtifact(matches)
}

const doesPackageObjectExistOnNetwork = async (
  tooling: Tooling,
  packageId: string
): Promise<boolean> => {
  try {
    const result = await tooling.suiClient.getObject({ id: packageId })
    return Boolean(result.data)
  } catch {
    return false
  }
}

const shouldSkipPublish = async (
  tooling: Tooling,
  rePublishFlag: boolean | undefined,
  deploymentArtifacts: PublishArtifact[],
  packagePath: string
): Promise<boolean> => {
  if (rePublishFlag) return false
  if (!hasDeploymentForPackage(deploymentArtifacts, packagePath)) return false

  const latestDeployment = getLatestDeploymentForPackagePath(
    deploymentArtifacts,
    packagePath
  )
  const latestPackageId = latestDeployment?.packageId
  if (!latestPackageId) return false

  const existsOnChain = await doesPackageObjectExistOnNetwork(
    tooling,
    latestPackageId
  )
  if (existsOnChain) return true

  logWarning(
    "Deployment artifact exists but the package object was not found on the target network. Republish will proceed to refresh deployments."
  )
  logKeyValueBlue("artifactPackageId")(latestPackageId)
  logKeyValueBlue("network")(tooling.network.networkName)

  return false
}

const logSkippedPublish = (networkName: string, packagePath: string) => {
  logWarning(
    "Package already published; skipping publish. Re-run with --re-publish to create a new deployment entry."
  )
  logKeyValueBlue("network")(networkName)
  logKeyValueBlue("package")(packagePath)
}

const buildFundingRequirements = (gasBudget: number) => {
  const minimumGasCoinBalance = BigInt(gasBudget) + 500_000_000n
  return {
    gasBudget,
    minimumGasCoinBalance,
    minimumBalance: minimumGasCoinBalance * 2n
  }
}

const readMoveTomlPackageName = async (
  packagePath: string
): Promise<string | undefined> => {
  const moveTomlPath = path.join(packagePath, "Move.toml")
  try {
    const contents = await fs.readFile(moveTomlPath, "utf8")
    return contents.match(/name\s*=\s*"([^"]+)"/)?.[1]
  } catch {
    return undefined
  }
}

const assertDependencyReplacementPresent = async ({
  moveTomlPath,
  environmentName,
  dependencyName,
  contextLabel
}: {
  moveTomlPath: string
  environmentName: string
  dependencyName: string
  contextLabel: string
}) => {
  let replacement:
    | { publishedAt?: string; originalId?: string; local?: string }
    | undefined
  try {
    replacement = await readMoveTomlDependencyReplacement({
      moveTomlPath,
      environmentName,
      dependencyName
    })
  } catch {
    throw new Error(
      `Unable to read ${contextLabel}. Ensure the path exists before publishing.`
    )
  }

  if (replacement?.publishedAt && replacement?.originalId) return
  if (replacement?.local) return

  throw new Error(
    [
      `Missing ${dependencyName} dep-replacements.${environmentName} entry in ${contextLabel}.`,
      `Run "pnpm mock:setup --re-publish" to publish DeepBook + token and update Move.toml mappings.`
    ].join(" ")
  )
}

const assertLocalnetPropAmmDependencyReplacements = async ({
  packagePath
}: {
  packagePath: string
}) => {
  const packageName = await readMoveTomlPackageName(packagePath)
  if (packageName !== AMM_PACKAGE_NAME) return

  const ammMoveTomlPath = path.join(packagePath, "Move.toml")
  await assertDependencyReplacementPresent({
    moveTomlPath: ammMoveTomlPath,
    environmentName: "localnet",
    dependencyName: DEEPBOOK_DEPENDENCY_NAME,
    contextLabel: ammMoveTomlPath
  })

  const deepbookMoveTomlPath = path.join(DEFAULT_DEEPBOOK_PATH, "Move.toml")
  await assertDependencyReplacementPresent({
    moveTomlPath: deepbookMoveTomlPath,
    environmentName: "localnet",
    dependencyName: DEEPBOOK_TOKEN_DEPENDENCY_NAME,
    contextLabel: deepbookMoveTomlPath
  })
}

const publishPackageToNetwork = async (
  tooling: Tooling,
  packagePath: string,
  publishOptions: ResolvedPublishOptions
) => {
  const {
    suiConfig: { network },
    loadedEd25519KeyPair: keypair
  } = tooling
  const gasBudget = network.gasBudget ?? DEFAULT_PUBLISH_GAS_BUDGET
  const { minimumGasCoinBalance, minimumBalance } =
    buildFundingRequirements(gasBudget)

  await tooling.withTestnetFaucetRetry(
    {
      signerAddress: keypair.toSuiAddress(),
      signer: keypair,
      minimumBalance,
      minimumCoinObjects: PUBLISH_MINIMUM_GAS_COIN_OBJECTS,
      minimumGasCoinBalance
    },
    async () =>
      tooling.publishPackageWithLog({
        packagePath,
        keypair,
        gasBudget,
        withUnpublishedDependencies: publishOptions.withUnpublishedDependencies,
        useCliPublish: publishOptions.useCliPublish,
        allowAutoUnpublishedDependencies:
          publishOptions.allowAutoUnpublishedDependencies
      })
  )
}

const derivePublishOptions = (
  networkName: string,
  cliArguments: {
    packagePath: string
    withUnpublishedDependencies?: boolean
    rePublish?: boolean
    useCliPublish?: boolean
  }
): ResolvedPublishOptions => {
  const targetingLocalnet = networkName === "localnet"
  const explicitlyDisabledUnpublishedDependencies =
    cliArguments.withUnpublishedDependencies === false

  if (!targetingLocalnet && cliArguments.withUnpublishedDependencies)
    throw new Error(
      "--with-unpublished-dependencies is reserved for localnet. Link to published packages in Move.lock for shared networks."
    )

  return {
    withUnpublishedDependencies:
      cliArguments.withUnpublishedDependencies ?? targetingLocalnet,
    allowAutoUnpublishedDependencies:
      targetingLocalnet && !explicitlyDisabledUnpublishedDependencies,
    useCliPublish: cliArguments.useCliPublish ?? true
  }
}

runSuiScript(
  async (tooling, cliArguments) => {
    await preflightMoveGitLocks({
      clearStaleLocks: cliArguments.clearStaleMoveLocks
    })

    // Resolve the absolute Move package path (relative to repo root or move/).
    const fullPackagePath = resolveFullPackagePath(
      path.resolve(tooling.suiConfig.paths.move),
      cliArguments.packagePath
    )
    const publishOptions = derivePublishOptions(
      tooling.suiConfig.network.networkName,
      cliArguments
    )

    if (cliArguments.rePublish) {
      const { didUpdate } = await clearPublishedEntryForNetwork({
        packagePath: fullPackagePath,
        networkName: tooling.suiConfig.network.networkName
      })
      if (didUpdate) {
        logKeyValueBlue("Published.toml")(
          `cleared ${tooling.suiConfig.network.networkName} entry`
        )
      }
    }

    // Load prior deployment artifacts to short-circuit if already published (unless --re-publish).
    const deploymentArtifacts = await loadDeploymentArtifacts(
      tooling.suiConfig.network.networkName
    )

    if (
      await shouldSkipPublish(
        tooling,
        cliArguments.rePublish,
        deploymentArtifacts,
        fullPackagePath
      )
    ) {
      logSkippedPublish(tooling.suiConfig.network.networkName, fullPackagePath)
      return
    }

    if (
      tooling.suiConfig.network.networkName === "localnet" &&
      !publishOptions.withUnpublishedDependencies &&
      !publishOptions.allowAutoUnpublishedDependencies
    ) {
      await assertLocalnetPropAmmDependencyReplacements({
        packagePath: fullPackagePath
      })
    }

    // Publish with network-aware options (unpublished deps localnet-only, published deps on shared nets).
    await publishPackageToNetwork(tooling, fullPackagePath, publishOptions)
  },
  yargs()
    .option("packagePath", {
      alias: "package-path",
      type: "string",
      description: `The path of the package to publish in "move" directory`,
      demandOption: true
    })
    .option("withUnpublishedDependencies", {
      alias: "with-unpublished-dependencies",
      type: "boolean",
      description: `Publish package with unpublished dependencies`,
      default: undefined
    })
    .option("rePublish", {
      alias: "re-publish",
      type: "boolean",
      description:
        "Re-publish the package even if it already exists in the deployment artifact",
      default: false
    })
    .option("useCliPublish", {
      alias: "use-cli-publish",
      type: "boolean",
      description:
        "Publish with the Sui CLI instead of the SDK (use --no-use-cli-publish to force SDK)",
      default: true
    })
    .option("clearStaleMoveLocks", {
      alias: "clear-stale-move-locks",
      type: "boolean",
      description:
        "Remove Move git lock files older than 10 minutes before publishing",
      default: false
    })
    .strict()
)
