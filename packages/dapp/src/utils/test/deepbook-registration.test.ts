import { beforeEach, describe, expect, it, vi } from "vitest"

const traderAccountModelMocks = vi.hoisted(() => ({
  findOwnedTraderAccountIds: vi.fn(),
  getTraderAccountOverview: vi.fn(),
  resolveTraderAccountType: vi.fn()
}))

const deepbookPtbMocks = vi.hoisted(() => ({
  buildCreateTraderAccountTransaction: vi.fn()
}))

const transactionMocks = vi.hoisted(() => ({
  ensureCreatedObject: vi.fn()
}))

vi.mock("@sui-amm/domain-core/models/traderAccount", () => ({
  findOwnedTraderAccountIds: traderAccountModelMocks.findOwnedTraderAccountIds,
  getTraderAccountOverview: traderAccountModelMocks.getTraderAccountOverview,
  resolveTraderAccountType: traderAccountModelMocks.resolveTraderAccountType
}))

vi.mock("@sui-amm/domain-core/ptb/deepbook", () => ({
  buildCreateTraderAccountTransaction:
    deepbookPtbMocks.buildCreateTraderAccountTransaction
}))

vi.mock("@sui-amm/tooling-node/transactions", () => ({
  ensureCreatedObject: transactionMocks.ensureCreatedObject
}))

import { resolveOrCreateTraderAccount } from "../deepbook-registration.ts"

type TraderAccountTooling = Parameters<
  typeof resolveOrCreateTraderAccount
>[0]["tooling"]

const buildTraderAccountOverview = (traderAccountId: string) => ({
  traderAccountId,
  ownerAddress: "0xowner",
  balanceManagerId: "0xbalance",
  tradeCapId: "0xtrade",
  depositCapId: "0xdeposit",
  withdrawCapId: "0xwithdraw"
})

const createTooling = (): TraderAccountTooling =>
  ({
    executeTransactionWithSummary: vi.fn(),
    loadedEd25519KeyPair: { toSuiAddress: () => "0xadmin" },
    suiClient: {}
  }) as unknown as TraderAccountTooling

describe("resolveOrCreateTraderAccount", () => {
  beforeEach(() => {
    traderAccountModelMocks.findOwnedTraderAccountIds.mockReset()
    traderAccountModelMocks.getTraderAccountOverview.mockReset()
    traderAccountModelMocks.resolveTraderAccountType.mockReset()
    traderAccountModelMocks.resolveTraderAccountType.mockImplementation(
      (packageId: string) => `${packageId}::executor::MarketMaker`
    )
    deepbookPtbMocks.buildCreateTraderAccountTransaction.mockReset()
    transactionMocks.ensureCreatedObject.mockReset()
  })

  it("reuses an owned market maker before creating a new one", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const resolveCreateDependencies = vi.fn(async () => ({
      adminCapId: "0xadmin-cap"
    }))

    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([
      "0xtrader"
    ])
    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue(
      buildTraderAccountOverview("0xtrader")
    )

    const result = await resolveOrCreateTraderAccount({
      tooling,
      ammPackageId: "0xamm",
      resolveCreateDependencies,
      deepbookRegistryId: "0xregistry",
      ownerAddress: "0xowner"
    })

    expect(
      traderAccountModelMocks.findOwnedTraderAccountIds
    ).toHaveBeenCalledWith({
      ownerAddress: "0xowner",
      packageId: "0xamm",
      suiClient: tooling.suiClient
    })
    expect(
      deepbookPtbMocks.buildCreateTraderAccountTransaction
    ).not.toHaveBeenCalled()
    expect(resolveCreateDependencies).not.toHaveBeenCalled()
    expect(executeTransactionWithSummary).not.toHaveBeenCalled()
    expect(result.status).toBe("existing")
    expect(result.traderAccount?.traderAccountId).toBe("0xtrader")
    expect(result.transactionSummaries.createTraderAccount).toBeUndefined()
  })

  it("returns dry-run feedback when creation would be required", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const resolveCreateDependencies = vi.fn(async () => ({
      adminCapId: "0xadmin-cap"
    }))

    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([])
    deepbookPtbMocks.buildCreateTraderAccountTransaction.mockReturnValue(
      "create-transaction"
    )
    executeTransactionWithSummary.mockResolvedValue({
      execution: undefined,
      summary: undefined
    })

    const result = await resolveOrCreateTraderAccount({
      tooling,
      ammPackageId: "0xamm",
      resolveCreateDependencies,
      deepbookRegistryId: "0xregistry",
      ownerAddress: "0xowner",
      dryRun: true
    })

    expect(
      deepbookPtbMocks.buildCreateTraderAccountTransaction
    ).toHaveBeenCalledWith({
      ammPackageId: "0xamm",
      adminCapId: "0xadmin-cap"
    })
    expect(resolveCreateDependencies).toHaveBeenCalledTimes(1)
    expect(result.status).toBe("dry-run-created")
    expect(result.note).toContain("Created object IDs are unavailable")
    expect(result.transactionSummaries.createTraderAccount?.label).toBe(
      "create-market-maker"
    )
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(1)
    expect(
      traderAccountModelMocks.getTraderAccountOverview
    ).not.toHaveBeenCalled()
  })

  it("fails clearly when multiple owned market makers exist and none is specified", async () => {
    const tooling = createTooling()
    const resolveCreateDependencies = vi.fn(async () => ({
      adminCapId: "0xadmin-cap"
    }))

    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([
      "0xtrader-a",
      "0xtrader-b"
    ])

    await expect(
      resolveOrCreateTraderAccount({
        tooling,
        ammPackageId: "0xamm",
        resolveCreateDependencies,
        deepbookRegistryId: "0xregistry",
        ownerAddress: "0xowner"
      })
    ).rejects.toThrow(
      "Multiple owned market makers were found for the active owner (2). Provide --trader-account-id to choose one explicitly."
    )
    expect(resolveCreateDependencies).not.toHaveBeenCalled()
  })

  it("uses an explicit market maker id without owned-account discovery", async () => {
    const tooling = createTooling()
    const resolveCreateDependencies = vi.fn(async () => ({
      adminCapId: "0xadmin-cap"
    }))

    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue(
      buildTraderAccountOverview("0xexplicit")
    )

    const result = await resolveOrCreateTraderAccount({
      tooling,
      ammPackageId: "0xamm",
      resolveCreateDependencies,
      deepbookRegistryId: "0xregistry",
      ownerAddress: "0xowner",
      traderAccountId: "0xexplicit"
    })

    expect(result.status).toBe("existing")
    expect(result.traderAccount?.traderAccountId).toBe("0xexplicit")
    expect(resolveCreateDependencies).not.toHaveBeenCalled()
    expect(
      traderAccountModelMocks.findOwnedTraderAccountIds
    ).not.toHaveBeenCalled()
  })

  it("creates and then loads the market maker when none exists", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const resolveCreateDependencies = vi.fn(async () => ({
      adminCapId: "0xadmin-cap"
    }))

    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([])
    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue(
      buildTraderAccountOverview("0xcreated-trader")
    )
    deepbookPtbMocks.buildCreateTraderAccountTransaction.mockReturnValue(
      "create-transaction"
    )
    transactionMocks.ensureCreatedObject.mockReturnValue({
      objectId: "0xcreated-trader"
    })
    executeTransactionWithSummary.mockResolvedValue({
      execution: { transactionResult: {} } as never,
      summary: { label: "create-market-maker" } as never
    })

    const result = await resolveOrCreateTraderAccount({
      tooling,
      ammPackageId: "0xamm",
      resolveCreateDependencies,
      deepbookRegistryId: "0xregistry",
      ownerAddress: "0xowner"
    })

    expect(result.status).toBe("created")
    expect(result.traderAccount?.traderAccountId).toBe("0xcreated-trader")
    expect(resolveCreateDependencies).toHaveBeenCalledTimes(1)
    expect(result.transactionSummaries.createTraderAccount?.label).toBe(
      "create-market-maker"
    )
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(1)
  })

  it("wraps model lookup failures with actionable context", async () => {
    const tooling = createTooling()
    const resolveCreateDependencies = vi.fn(async () => ({
      adminCapId: "0xadmin-cap"
    }))

    traderAccountModelMocks.getTraderAccountOverview.mockRejectedValue(
      new Error("Object not found")
    )

    await expect(
      resolveOrCreateTraderAccount({
        tooling,
        ammPackageId: "0xamm",
        resolveCreateDependencies,
        deepbookRegistryId: "0xregistry",
        ownerAddress: "0xowner",
        traderAccountId: "0xexplicit"
      })
    ).rejects.toThrow(
      "Market maker lookup failed for traderAccountId 0xexplicit (expected owner 0xowner, expected package 0xamm, expected type 0xamm::executor::MarketMaker). Cause: Object not found"
    )
    expect(resolveCreateDependencies).not.toHaveBeenCalled()
  })

  it("fails with clear context when the market maker owner mismatches", async () => {
    const tooling = createTooling()
    const resolveCreateDependencies = vi.fn(async () => ({
      adminCapId: "0xadmin-cap"
    }))

    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue({
      ...buildTraderAccountOverview("0xexplicit"),
      ownerAddress: "0xanother-owner"
    })

    await expect(
      resolveOrCreateTraderAccount({
        tooling,
        ammPackageId: "0xamm",
        resolveCreateDependencies,
        deepbookRegistryId: "0xregistry",
        ownerAddress: "0xowner",
        traderAccountId: "0xexplicit"
      })
    ).rejects.toThrow(
      "Market maker owner mismatch for traderAccountId 0xexplicit. Expected owner 0xowner, found 0xanother-owner, expected package 0xamm."
    )
    expect(resolveCreateDependencies).not.toHaveBeenCalled()
  })
})
