import { beforeEach, describe, expect, it, vi } from "vitest"

const traderAccountMocks = vi.hoisted(() => ({
  resolveOwnedTraderAccountId: vi.fn(),
  getOwnedTraderAccountOverview: vi.fn()
}))

const deepbookPtbMocks = vi.hoisted(() => ({
  buildCreateTraderAccountTransaction: vi.fn(),
  buildRegisterBalanceManagerTransaction: vi.fn()
}))

const transactionMocks = vi.hoisted(() => ({
  ensureCreatedObject: vi.fn()
}))

vi.mock("../trader-account.ts", () => ({
  resolveOwnedTraderAccountId: traderAccountMocks.resolveOwnedTraderAccountId,
  getOwnedTraderAccountOverview:
    traderAccountMocks.getOwnedTraderAccountOverview
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

const traderAccountOverview = {
  traderAccountId: "0xtrader",
  ownerAddress: "0xowner",
  balanceManagerId: "0xbalance",
  balanceManagerBalancesBagId: "0xbag",
  tradeCapId: "0xtrade",
  depositCapId: "0xdeposit",
  withdrawCapId: "0xwithdraw"
}

describe("createTraderAccountAndRegisterBalanceManager", () => {
  beforeEach(() => {
    traderAccountMocks.resolveOwnedTraderAccountId.mockReset()
    traderAccountMocks.getOwnedTraderAccountOverview.mockReset()
    deepbookPtbMocks.buildCreateTraderAccountTransaction.mockReset()
    deepbookPtbMocks.buildRegisterBalanceManagerTransaction.mockReset()
    transactionMocks.ensureCreatedObject.mockReset()
  })

  it("reuses an existing trader account and only runs registration", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getMutableSharedObject = vi.mocked(tooling.getMutableSharedObject)

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0xtrader")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue(
      traderAccountOverview
    )
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
      ammAdminCapId: "0xadmin-cap"
    })

    expect(traderAccountMocks.resolveOwnedTraderAccountId).toHaveBeenCalledWith(
      {
        tooling,
        ownerAddress: "0xowner",
        ammPackageId: "0xamm"
      }
    )
    expect(
      deepbookPtbMocks.buildCreateTraderAccountTransaction
    ).not.toHaveBeenCalled()
    expect(
      deepbookPtbMocks.buildRegisterBalanceManagerTransaction
    ).toHaveBeenCalledWith({
      ammPackageId: "0xamm",
      traderAccountId: "0xtrader",
      deepbookRegistry: { sharedRef: { objectId: "0xregistry" } },
      ammAdminCapId: "0xadmin-cap"
    })
    expect(result.status).toBe("registered")
    expect(result.traderAccount?.traderAccountId).toBe("0xtrader")
    expect(result.transactionSummaries.createTraderAccount).toBeUndefined()
    expect(result.transactionSummaries.registerBalanceManager).toEqual({
      label: "register-balance-manager"
    })
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(1)
  })

  it("returns dry-run create feedback when no account exists", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getImmutableSharedObject = vi.mocked(tooling.getImmutableSharedObject)

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue(undefined)
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
      ammAdminCapId: "0xadmin-cap",
      dryRun: true
    })

    expect(result.status).toBe("dry-run-create-only")
    expect(result.note).toContain("Created object IDs are unavailable")
    expect(result.transactionSummaries.createTraderAccount?.label).toBe(
      "create-trader-account"
    )
    expect(
      deepbookPtbMocks.buildRegisterBalanceManagerTransaction
    ).not.toHaveBeenCalled()
  })

  it("creates and then registers when no account exists", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getImmutableSharedObject = vi.mocked(tooling.getImmutableSharedObject)
    const getMutableSharedObject = vi.mocked(tooling.getMutableSharedObject)

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue(undefined)
    transactionMocks.ensureCreatedObject.mockReturnValue({
      objectId: "0xcreated-trader"
    })
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      ...traderAccountOverview,
      traderAccountId: "0xcreated-trader"
    })
    getImmutableSharedObject.mockResolvedValue({
      sharedRef: { objectId: "0xregistry" }
    } as never)
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
      ownerAddress: "0xowner",
      ammAdminCapId: "0xadmin-cap"
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

  it("bubbles up trader-account lookup failures during registration", async () => {
    const tooling = createTooling()

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0xtrader")
    traderAccountMocks.getOwnedTraderAccountOverview.mockRejectedValue(
      new Error("Object not found")
    )

    await expect(
      createTraderAccountAndRegisterBalanceManager({
        tooling,
        ammPackageId: "0xamm",
        deepbookRegistryId: "0xregistry",
        ownerAddress: "0xowner",
        ammAdminCapId: "0xadmin-cap"
      })
    ).rejects.toThrow("Object not found")
  })
})
