import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { beforeEach, describe, expect, it, vi } from "vitest"

const dynamicFieldMocks = vi.hoisted(() => ({
  getAllDynamicFields: vi.fn()
}))

vi.mock("@sui-amm/tooling-core/dynamic-fields", () => ({
  getAllDynamicFields: dynamicFieldMocks.getAllDynamicFields
}))

import {
  DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK,
  isBalanceManagerMapInitialized,
  isPropAmmAppAuthorizedInRegistry,
  resolvePropAmmAppType
} from "@sui-amm/domain-core/models/deepbook"

const buildDynamicField = (fieldType: string) =>
  ({ name: { type: fieldType } }) as never

describe("deepbook model compatibility", () => {
  beforeEach(() => {
    dynamicFieldMocks.getAllDynamicFields.mockReset()
  })

  it("matches AppKey for the originalId when caller provides publishedAt", async () => {
    const deepbookIds = DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK.testnet
    const ammPackageId = "0xamm"

    dynamicFieldMocks.getAllDynamicFields.mockResolvedValue([
      buildDynamicField(
        `${deepbookIds.originalId}::registry::AppKey<${resolvePropAmmAppType(
          ammPackageId
        )}>`
      )
    ])

    const isAuthorized = await isPropAmmAppAuthorizedInRegistry({
      suiClient: {} as never,
      deepbookRegistryId: "0xregistry",
      deepbookPackageId: deepbookIds.publishedAt,
      ammPackageId
    })

    expect(isAuthorized).toBe(true)
  })

  it("matches AppKey for the publishedAt when caller provides originalId", async () => {
    const deepbookIds = DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK.mainnet
    const ammPackageId = "0xamm"

    dynamicFieldMocks.getAllDynamicFields.mockResolvedValue([
      buildDynamicField(
        `${deepbookIds.publishedAt}::registry::AppKey<${resolvePropAmmAppType(
          ammPackageId
        )}>`
      )
    ])

    const isAuthorized = await isPropAmmAppAuthorizedInRegistry({
      suiClient: {} as never,
      deepbookRegistryId: "0xregistry",
      deepbookPackageId: deepbookIds.originalId,
      ammPackageId
    })

    expect(isAuthorized).toBe(true)
  })

  it("falls back to exact package id matching for unknown package ids", async () => {
    const unknownDeepbookPackageId = "0xdeadbeef"
    const normalizedUnknownDeepbookPackageId = normalizeSuiObjectId(
      unknownDeepbookPackageId
    )

    dynamicFieldMocks.getAllDynamicFields.mockResolvedValue([
      buildDynamicField(
        `${normalizedUnknownDeepbookPackageId}::registry::BalanceManagerKey`
      )
    ])

    const isInitialized = await isBalanceManagerMapInitialized({
      suiClient: {} as never,
      deepbookRegistryId: "0xregistry",
      deepbookPackageId: unknownDeepbookPackageId
    })

    expect(isInitialized).toBe(true)
  })

  it("does not match unrelated dynamic field types", async () => {
    dynamicFieldMocks.getAllDynamicFields.mockResolvedValue([
      buildDynamicField("0xother::registry::BalanceManagerKey")
    ])

    const isInitialized = await isBalanceManagerMapInitialized({
      suiClient: {} as never,
      deepbookRegistryId: "0xregistry",
      deepbookPackageId:
        DEEPBOOK_PUBLISHED_PACKAGE_IDS_BY_NETWORK.testnet.publishedAt
    })

    expect(isInitialized).toBe(false)
  })
})
