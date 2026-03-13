import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import { getAllDynamicFields } from "@sui-amm/tooling-core/dynamic-fields"
import { normalizeIdOrThrow } from "@sui-amm/tooling-core/object"
import { PROP_AMM_EXECUTOR_SUFFIX } from "./amm.ts"

export const DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK = {
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

export const DEEPBOOK_REGISTRY_IDS_BY_NETWORK = {
  testnet: "0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1",
  mainnet: "0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d"
} as const

export type DeepbookPublishedIds =
  (typeof DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK)[keyof typeof DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK]

export const resolveDeepbookPublishedIds = (
  networkName: string
): DeepbookPublishedIds | undefined => {
  if (networkName === "testnet")
    return DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK.testnet
  if (networkName === "mainnet")
    return DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK.mainnet
  return undefined
}

export const resolveDeepbookRegistryIdForNetwork = (
  networkName: string
): string | undefined => {
  if (networkName === "testnet") return DEEPBOOK_REGISTRY_IDS_BY_NETWORK.testnet
  if (networkName === "mainnet") return DEEPBOOK_REGISTRY_IDS_BY_NETWORK.mainnet
  return undefined
}

export const resolveDeepbookNetworkIds = (
  networkName: string
):
  | {
      packageId: string
      registryId: string
    }
  | undefined => {
  const publishedIds = resolveDeepbookPublishedIds(networkName)
  const registryId = resolveDeepbookRegistryIdForNetwork(networkName)
  if (!publishedIds || !registryId) return undefined

  return {
    packageId: publishedIds.publishedAt,
    registryId
  }
}

export const resolveDeepbookPackageId = (
  value?: string,
  errorMessage?: string
) =>
  normalizeIdOrThrow(
    value,
    errorMessage ??
      "DeepBook package id is required; provide --deepbook-package-id."
  )

export const resolveDeepbookRegistryId = (
  value?: string,
  errorMessage?: string
) =>
  normalizeIdOrThrow(
    value,
    errorMessage ??
      "DeepBook registry id is required; provide --deepbook-registry-id."
  )

export const resolveDeepbookAdminCapId = (
  value?: string,
  errorMessage?: string
) =>
  normalizeIdOrThrow(
    value,
    errorMessage ??
      "DeepBook admin cap id is required; provide --deepbook-admin-cap-id."
  )

export const resolvePropAmmAppType = (ammPackageId: string) =>
  `${ammPackageId}${PROP_AMM_EXECUTOR_SUFFIX}`

const hasAnyDynamicFieldType = async ({
  suiClient,
  parentObjectId,
  fieldTypes
}: {
  suiClient: SuiClient
  parentObjectId: string
  fieldTypes: string[]
}): Promise<boolean> => {
  const uniqueFieldTypes = [...new Set(fieldTypes)]
  if (uniqueFieldTypes.length === 0) return false

  const dynamicFields = await getAllDynamicFields(
    { parentObjectId },
    { suiClient }
  )

  return dynamicFields.some(
    (field) =>
      typeof field.name?.type === "string" &&
      uniqueFieldTypes.includes(field.name.type)
  )
}

const resolveKnownDeepbookPackageIdCandidates = (
  deepbookPackageId: string
): string[] => {
  const normalizedPackageId = normalizeSuiObjectId(deepbookPackageId)

  const knownPairs = Object.values(DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK)
  const matchingPair = knownPairs.find(
    (pair) =>
      normalizeSuiObjectId(pair.publishedAt) === normalizedPackageId ||
      normalizeSuiObjectId(pair.originalId) === normalizedPackageId
  )

  if (!matchingPair) return [normalizedPackageId]

  return [
    normalizeSuiObjectId(matchingPair.publishedAt),
    normalizeSuiObjectId(matchingPair.originalId)
  ]
}

const buildKeyTypesForKnownDeepbookPackage = ({
  deepbookPackageId,
  buildFieldType
}: {
  deepbookPackageId: string
  buildFieldType: (candidatePackageId: string) => string
}): string[] =>
  resolveKnownDeepbookPackageIdCandidates(deepbookPackageId).map(
    (candidatePackageId) => buildFieldType(candidatePackageId)
  )

const resolvePropAmmAppKeyTypes = ({
  deepbookPackageId,
  ammPackageId
}: {
  deepbookPackageId: string
  ammPackageId: string
}): string[] =>
  buildKeyTypesForKnownDeepbookPackage({
    deepbookPackageId,
    buildFieldType: (candidatePackageId) =>
      `${candidatePackageId}::registry::AppKey<${resolvePropAmmAppType(
        ammPackageId
      )}>`
  })

const resolveBalanceManagerKeyTypes = (deepbookPackageId: string): string[] =>
  buildKeyTypesForKnownDeepbookPackage({
    deepbookPackageId,
    buildFieldType: (candidatePackageId) =>
      `${candidatePackageId}::registry::BalanceManagerKey`
  })

export const isPropAmmAppAuthorizedInRegistry = async ({
  suiClient,
  deepbookRegistryId,
  deepbookPackageId,
  ammPackageId
}: {
  suiClient: SuiClient
  deepbookRegistryId: string
  deepbookPackageId: string
  ammPackageId: string
}): Promise<boolean> =>
  hasAnyDynamicFieldType({
    suiClient,
    parentObjectId: deepbookRegistryId,
    fieldTypes: resolvePropAmmAppKeyTypes({
      deepbookPackageId,
      ammPackageId
    })
  })

export const isBalanceManagerMapInitialized = async ({
  suiClient,
  deepbookRegistryId,
  deepbookPackageId
}: {
  suiClient: SuiClient
  deepbookRegistryId: string
  deepbookPackageId: string
}): Promise<boolean> =>
  hasAnyDynamicFieldType({
    suiClient,
    parentObjectId: deepbookRegistryId,
    fieldTypes: resolveBalanceManagerKeyTypes(deepbookPackageId)
  })
