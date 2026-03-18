import path from "node:path"

import type { SuiClient } from "@mysten/sui/client"
import { parseTypeNameFromString } from "@sui-amm/tooling-core/utils/type-name"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import {
  canonicalizePackagePath,
  readMoveTomlDependencyReplacement,
  resolveMoveCliEnvironmentName
} from "@sui-amm/tooling-node/move"
import { DEFAULT_DEEPBOOK_PATH } from "./mocks.ts"
import { resolveAmmPackagePath } from "./amm.ts"
import {
  loadPublishTransaction,
  resolveCreatedObjectFromPublishTransaction
} from "./publish.ts"

const DEEPBOOK_DEPENDENCY_NAME = "deepbook"
const DEEPBOOK_TOKEN_DEPENDENCY_NAME = "token"
const LOCALNET_MOVE_ENVIRONMENT_NAME =
  resolveMoveCliEnvironmentName("localnet") ?? "test-publish"

const DEEPBOOK_PUBLISHED_IDS_BY_NETWORK = {
  testnet: {
    publishedAt:
      "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c",
    originalId:
      "0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982"
  },
  mainnet: {
    publishedAt:
      "0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497",
    originalId:
      "0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809"
  }
} as const

type DependencyReplacement = {
  publishedAt?: string
  originalId?: string
  local?: string
}

type ReadDependencyReplacementResult =
  | { status: "ok"; replacement: DependencyReplacement | undefined }
  | { status: "error" }

export const resolveDeepbookPublishedIds = (networkName: string) =>
  DEEPBOOK_PUBLISHED_IDS_BY_NETWORK[
    networkName as keyof typeof DEEPBOOK_PUBLISHED_IDS_BY_NETWORK
  ]

export type DeepbookPublishObjects = {
  deepbookPackageId: string
  deepbookRegistryId: string
  deepbookAdminCapId: string
}

export const resolveDeepbookPublishObjectsFromDigest = async ({
  publishDigest,
  suiClient
}: {
  publishDigest: string
  suiClient: SuiClient
}): Promise<DeepbookPublishObjects> => {
  const publishTransaction = await loadPublishTransaction({
    publishDigest,
    suiClient
  })

  const deepbookRegistryObject = resolveCreatedObjectFromPublishTransaction({
    publishTransaction,
    objectTypeSuffix: "::registry::Registry"
  })
  const deepbookAdminCap = resolveCreatedObjectFromPublishTransaction({
    publishTransaction,
    objectTypeSuffix: "::registry::DeepbookAdminCap"
  })
  const deepbookRegistryType = deepbookRegistryObject.objectType

  if (!deepbookRegistryType) {
    throw new Error(
      `Unable to resolve DeepBook package id from registry object ${deepbookRegistryObject.objectId}.`
    )
  }

  return {
    deepbookPackageId: parseTypeNameFromString(deepbookRegistryType).packageId,
    deepbookRegistryId: deepbookRegistryObject.objectId,
    deepbookAdminCapId: deepbookAdminCap.objectId
  }
}

const resolveMoveTomlPath = (packagePath: string) =>
  path.join(packagePath, "Move.toml")

const isReplacementReady = (replacement: DependencyReplacement | undefined) =>
  Boolean(
    (replacement?.publishedAt && replacement?.originalId) || replacement?.local
  )

const readDependencyReplacement = async ({
  moveTomlPath,
  environmentName,
  dependencyName
}: {
  moveTomlPath: string
  environmentName: string
  dependencyName: string
}): Promise<ReadDependencyReplacementResult> => {
  try {
    return {
      status: "ok",
      replacement: await readMoveTomlDependencyReplacement({
        moveTomlPath,
        environmentName,
        dependencyName
      })
    }
  } catch {
    return { status: "error" }
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
  const dependencyReplacementResult = await readDependencyReplacement({
    moveTomlPath,
    environmentName,
    dependencyName
  })

  if (dependencyReplacementResult.status === "error") {
    throw new Error(
      `Unable to read ${contextLabel}. Ensure the path exists before publishing.`
    )
  }

  if (isReplacementReady(dependencyReplacementResult.replacement)) return

  throw new Error(
    [
      `Missing ${dependencyName} dep-replacements.${environmentName} entry in ${contextLabel}.`,
      'Run "pnpm --filter dapp mock:setup --re-publish" to prepare the DeepBook dependency mappings first.'
    ].join(" ")
  )
}

const resolveDeepbookMoveTomlPath = async ({
  ammMoveTomlPath,
  environmentName
}: {
  ammMoveTomlPath: string
  environmentName: string
}) => {
  const dependencyReplacementResult = await readDependencyReplacement({
    moveTomlPath: ammMoveTomlPath,
    environmentName,
    dependencyName: DEEPBOOK_DEPENDENCY_NAME
  })

  if (
    dependencyReplacementResult.status === "ok" &&
    dependencyReplacementResult.replacement?.local
  ) {
    const deepbookPackagePath = path.resolve(
      path.dirname(ammMoveTomlPath),
      dependencyReplacementResult.replacement.local
    )

    return resolveMoveTomlPath(deepbookPackagePath)
  }

  return resolveMoveTomlPath(DEFAULT_DEEPBOOK_PATH)
}

const isAmmPackagePath = ({
  tooling,
  packagePath
}: {
  tooling: Pick<Tooling, "suiConfig">
  packagePath: string
}) =>
  canonicalizePackagePath(packagePath) ===
  canonicalizePackagePath(resolveAmmPackagePath(tooling))

export const assertLocalnetAmmDependencyReplacementsReady = async ({
  tooling,
  packagePath
}: {
  tooling: Pick<Tooling, "suiConfig">
  packagePath: string
}) => {
  if (!isAmmPackagePath({ tooling, packagePath })) return

  const ammMoveTomlPath = resolveMoveTomlPath(packagePath)
  await assertDependencyReplacementPresent({
    moveTomlPath: ammMoveTomlPath,
    environmentName: LOCALNET_MOVE_ENVIRONMENT_NAME,
    dependencyName: DEEPBOOK_DEPENDENCY_NAME,
    contextLabel: ammMoveTomlPath
  })

  const deepbookMoveTomlPath = await resolveDeepbookMoveTomlPath({
    ammMoveTomlPath,
    environmentName: LOCALNET_MOVE_ENVIRONMENT_NAME
  })
  await assertDependencyReplacementPresent({
    moveTomlPath: deepbookMoveTomlPath,
    environmentName: LOCALNET_MOVE_ENVIRONMENT_NAME,
    dependencyName: DEEPBOOK_TOKEN_DEPENDENCY_NAME,
    contextLabel: deepbookMoveTomlPath
  })
}
