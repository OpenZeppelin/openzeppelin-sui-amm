import { beforeEach, describe, expect, it, vi } from "vitest"

const traderAccountModelMocks = vi.hoisted(() => ({
  findOwnedTraderAccountIds: vi.fn(),
  getTraderAccountOverview: vi.fn(),
  resolveTraderAccountType: vi.fn()
}))

const deepbookPtbMocks = vi.hoisted(() => ({
  buildCreateTraderAccountTransaction: vi.fn(),
  buildRegisterBalanceManagerTransaction: vi.fn()
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
    deepbookPtbMocks.buildCreateTraderAccountTransaction,
  buildRegisterBalanceManagerTransaction:
    deepbookPtbMocks.buildRegisterBalanceManagerTransaction
}))

vi.mock("@sui-amm/tooling-node/transactions", () => ({
  ensureCreatedObject: transactionMocks.ensureCreatedObject
}))

import { createTraderAccountAndRegisterBalanceManager } from "../deepbook-registration.ts"

type RegistrationTooling = Parameters<
  typeof createTraderAccountAndRegisterBalanceManager
>[0]["tooling"]

const createTooling = (): RegistrationTooling =>
  ({
    executeTransactionWithSummary: vi.fn(),
    getImmutableSharedObject: vi.fn(),
    getMutableSharedObject: vi.fn(),
    loadedEd25519KeyPair: { toSuiAddress: () => "0xowner" },
    suiClient: {}
  }) as unknown as RegistrationTooling

describe("createTraderAccountAndRegisterBalanceManager", () => {
  beforeEach(() => {
    traderAccountModelMocks.findOwnedTraderAccountIds.mockReset()
    traderAccountModelMocks.getTraderAccountOverview.mockReset()
    traderAccountModelMocks.resolveTraderAccountType.mockReset()
    traderAccountModelMocks.resolveTraderAccountType.mockImplementation(
      (packageId: string) => `${packageId}::executor::TraderAccount`
    )
    deepbookPtbMocks.buildCreateTraderAccountTransaction.mockReset()
    deepbookPtbMocks.buildRegisterBalanceManagerTransaction.mockReset()
    transactionMocks.ensureCreatedObject.mockReset()
  })

  it("reuses an owned trader account before creating a new one", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getImmutableSharedObject = vi.mocked(tooling.getImmutableSharedObject)
    const getMutableSharedObject = vi.mocked(tooling.getMutableSharedObject)

    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([
      "0xtrader"
    ])
    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0xtrader",
      ownerAddress: "0xowner",
      balanceManagerId: "0xbalance"
    })
    getImmutableSharedObject.mockResolvedValue({
      sharedRef: { objectId: "0xbalance" }
    } as never)
    getMutableSharedObject.mockResolvedValue({
      sharedRef: { objectId: "0xregistry" }
    } as never)
    deepbookPtbMocks.buildRegisterBalanceManagerTransaction.mockReturnValue(
      "register-transaction"
    )
    executeTransactionWithSummary.mockResolvedValue({
      summary: { label: "register-balance-manager" } as never
    })

    const result = await createTraderAccountAndRegisterBalanceManager({
      tooling,
      ammPackageId: "0xamm",
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
    expect(result.transactionSummaries.createTraderAccount).toBeUndefined()
    expect(result.transactionSummaries.registerBalanceManager).toEqual({
      label: "register-balance-manager"
    })
    expect(result.status).toBe("registered")
    expect(result.traderAccount?.traderAccountId).toBe("0xtrader")
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(1)
  })

  it("returns partial feedback on dry-run when creation would be required", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getImmutableSharedObject = vi.mocked(tooling.getImmutableSharedObject)

    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([])
    getImmutableSharedObject.mockResolvedValue({
      sharedRef: { objectId: "0xregistry" }
    } as never)
    deepbookPtbMocks.buildCreateTraderAccountTransaction.mockReturnValue(
      "create-transaction"
    )
    executeTransactionWithSummary.mockResolvedValue({
      execution: undefined,
      summary: undefined
    })

    const result = await createTraderAccountAndRegisterBalanceManager({
      tooling,
      ammPackageId: "0xamm",
      deepbookRegistryId: "0xregistry",
      ownerAddress: "0xowner",
      dryRun: true
    })

    expect(
      deepbookPtbMocks.buildCreateTraderAccountTransaction
    ).toHaveBeenCalled()
    expect(
      deepbookPtbMocks.buildRegisterBalanceManagerTransaction
    ).not.toHaveBeenCalled()
    expect(result.status).toBe("dry-run-create-only")
    expect(result.note).toContain("Created object IDs are unavailable")
    expect(result.transactionSummaries.createTraderAccount?.label).toBe(
      "create-trader-account"
    )
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(1)
  })

  it("fails clearly when multiple owned trader accounts exist and none is specified", async () => {
    const tooling = createTooling()

    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([
      "0xtrader-a",
      "0xtrader-b"
    ])

    await expect(
      createTraderAccountAndRegisterBalanceManager({
        tooling,
        ammPackageId: "0xamm",
        deepbookRegistryId: "0xregistry",
        ownerAddress: "0xowner"
      })
    ).rejects.toThrow(
      "Multiple owned trader accounts were found for the active owner (2). Provide --trader-account-id to choose one explicitly."
    )
  })

  it("uses explicit trader account id without owned-account discovery", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getImmutableSharedObject = vi.mocked(tooling.getImmutableSharedObject)
    const getMutableSharedObject = vi.mocked(tooling.getMutableSharedObject)

    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0xexplicit",
      ownerAddress: "0xowner",
      balanceManagerId: "0xbalance"
    })
    getImmutableSharedObject.mockResolvedValue({
      sharedRef: { objectId: "0xbalance" }
    } as never)
    getMutableSharedObject.mockResolvedValue({
      sharedRef: { objectId: "0xregistry" }
    } as never)
    deepbookPtbMocks.buildRegisterBalanceManagerTransaction.mockReturnValue(
      "register-transaction"
    )
    executeTransactionWithSummary.mockResolvedValue({
      summary: { label: "register-balance-manager" } as never
    })

    const result = await createTraderAccountAndRegisterBalanceManager({
      tooling,
      ammPackageId: "0xamm",
      deepbookRegistryId: "0xregistry",
      ownerAddress: "0xowner",
      traderAccountId: "0xexplicit"
    })

    expect(result.status).toBe("registered")
    expect(result.traderAccount?.traderAccountId).toBe("0xexplicit")
    expect(
      traderAccountModelMocks.findOwnedTraderAccountIds
    ).not.toHaveBeenCalled()
  })

  it("creates and then registers when no trader account exists", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getImmutableSharedObject = vi.mocked(tooling.getImmutableSharedObject)
    const getMutableSharedObject = vi.mocked(tooling.getMutableSharedObject)

    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([])
    transactionMocks.ensureCreatedObject.mockReturnValue({
      objectId: "0xcreated-trader"
    })
    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0xcreated-trader",
      ownerAddress: "0xowner",
      balanceManagerId: "0xbalance"
    })
    getImmutableSharedObject
      .mockResolvedValueOnce({ sharedRef: { objectId: "0xregistry" } } as never)
      .mockResolvedValueOnce({ sharedRef: { objectId: "0xbalance" } } as never)
    getMutableSharedObject.mockResolvedValue({
      sharedRef: { objectId: "0xregistry" }
    } as never)
    deepbookPtbMocks.buildCreateTraderAccountTransaction.mockReturnValue(
      "create-transaction"
    )
    deepbookPtbMocks.buildRegisterBalanceManagerTransaction.mockReturnValue(
      "register-transaction"
    )
    executeTransactionWithSummary
      .mockResolvedValueOnce({
        execution: { transactionResult: {} } as never,
        summary: { label: "create-trader-account" } as never
      })
      .mockResolvedValueOnce({
        summary: { label: "register-balance-manager" } as never
      })

    const result = await createTraderAccountAndRegisterBalanceManager({
      tooling,
      ammPackageId: "0xamm",
      deepbookRegistryId: "0xregistry",
      ownerAddress: "0xowner"
    })

    expect(result.status).toBe("registered")
    expect(result.transactionSummaries.createTraderAccount?.label).toBe(
      "create-trader-account"
    )
    expect(result.transactionSummaries.registerBalanceManager?.label).toBe(
      "register-balance-manager"
    )
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(2)
  })

  it("wraps model lookup failures with actionable context", async () => {
    const tooling = createTooling()

    traderAccountModelMocks.getTraderAccountOverview.mockRejectedValue(
      new Error("Object not found")
    )

    await expect(
      createTraderAccountAndRegisterBalanceManager({
        tooling,
        ammPackageId: "0xamm",
        deepbookRegistryId: "0xregistry",
        ownerAddress: "0xowner",
        traderAccountId: "0xexplicit"
      })
    ).rejects.toThrow(
      "Trader account lookup failed for traderAccountId 0xexplicit (expected owner 0xowner, expected package 0xamm, expected type 0xamm::executor::TraderAccount). Cause: Object not found"
    )
  })

  it("fails with clear context when trader account owner mismatches", async () => {
    const tooling = createTooling()

    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0xexplicit",
      ownerAddress: "0xanother-owner",
      balanceManagerId: "0xbalance"
    })

    await expect(
      createTraderAccountAndRegisterBalanceManager({
        tooling,
        ammPackageId: "0xamm",
        deepbookRegistryId: "0xregistry",
        ownerAddress: "0xowner",
        traderAccountId: "0xexplicit"
      })
    ).rejects.toThrow(
      "Trader account owner mismatch for traderAccountId 0xexplicit. Expected owner 0xowner, found 0xanother-owner, expected package 0xamm."
    )
  })
})
