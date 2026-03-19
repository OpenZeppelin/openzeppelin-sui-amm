import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import { beforeEach, describe, expect, it, vi } from "vitest"

const traderAccountMocks = vi.hoisted(() => ({
  resolveOwnedTraderAccountId: vi.fn(),
  getOwnedTraderAccountOverview: vi.fn()
}))

const domainTraderAccountMocks = vi.hoisted(() => ({
  getBalanceManagerAssetBalancesByBagId: vi.fn()
}))

vi.mock("@sui-amm/domain-core/models/traderAccount", async () => {
  const actual = await vi.importActual(
    "@sui-amm/domain-core/models/traderAccount"
  )

  return {
    ...actual,
    getBalanceManagerAssetBalancesByBagId:
      domainTraderAccountMocks.getBalanceManagerAssetBalancesByBagId
  }
})

vi.mock("../trader-account.ts", () => ({
  resolveOwnedTraderAccountId: traderAccountMocks.resolveOwnedTraderAccountId,
  getOwnedTraderAccountOverview:
    traderAccountMocks.getOwnedTraderAccountOverview
}))

import { withdrawFromExistingTraderAccount } from "../trader-account-withdrawal.ts"

type WithdrawalTooling = Parameters<
  typeof withdrawFromExistingTraderAccount
>[0]["tooling"]

const createTooling = (): WithdrawalTooling =>
  ({
    executeTransactionWithSummary: vi.fn(),
    loadedEd25519KeyPair: { toSuiAddress: () => "0xabc" },
    suiClient: {}
  }) as unknown as WithdrawalTooling

const SUI_COIN_TYPE = normalizeSuiObjectId("0x2") + "::sui::SUI"

const mockBalanceManagerBalance = (balance: bigint) => {
  domainTraderAccountMocks.getBalanceManagerAssetBalancesByBagId.mockResolvedValue(
    [
      {
        coinType: SUI_COIN_TYPE,
        balance
      }
    ]
  )
}

const expectMoveCall = (
  command: ReturnType<Transaction["getData"]>["commands"][number]
) => {
  expect(command.$kind).toBe("MoveCall")
  if (command.$kind !== "MoveCall") {
    throw new Error("Expected MoveCall command.")
  }

  return command.MoveCall
}

describe("withdrawFromExistingTraderAccount", () => {
  beforeEach(() => {
    traderAccountMocks.resolveOwnedTraderAccountId.mockReset()
    traderAccountMocks.getOwnedTraderAccountOverview.mockReset()
    domainTraderAccountMocks.getBalanceManagerAssetBalancesByBagId.mockReset()
  })

  it("withdraws funds and transfers the withdrawn coin to the recipient", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: normalizeSuiAddress("0xabc"),
      balanceManagerId: "0x222",
      balanceManagerBalancesBagId: "0x333"
    })
    mockBalanceManagerBalance(100n)
    executeTransactionWithSummary.mockResolvedValue({
      summary: { label: "withdraw-trader-account" } as never
    })

    const result = await withdrawFromExistingTraderAccount({
      tooling,
      ammPackageId: "0x555",
      ammAdminCapId: "0xa11",
      coinType: "0x2::sui::SUI",
      amount: "25",
      recipientAddress: "0xdef"
    })

    expect(result.status).toBe("withdrawn")
    expect(result.amount).toBe("25")
    expect(result.coinType).toBe(normalizeSuiAddress("0x2") + "::sui::SUI")
    expect(result.recipientAddress).toBe(normalizeSuiAddress("0xdef"))
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(1)

    const withdrawalTransaction =
      executeTransactionWithSummary.mock.calls[0]?.[0].transaction
    const transactionCommands = withdrawalTransaction.getData().commands
    const withdrawalMoveCall = expectMoveCall(transactionCommands[0] as never)

    expect(transactionCommands).toHaveLength(2)
    expect(withdrawalMoveCall).toMatchObject({
      module: "executor",
      function: "withdraw",
      typeArguments: [normalizeSuiObjectId("0x2") + "::sui::SUI"]
    })
    expect(transactionCommands[1]).toMatchObject({
      $kind: "TransferObjects"
    })
  })

  it("normalizes wrapped Coin<T> inputs before building withdrawal PTBs", async () => {
    const tooling = createTooling()
    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: normalizeSuiAddress("0xabc"),
      balanceManagerId: "0x222",
      balanceManagerBalancesBagId: "0x333"
    })
    mockBalanceManagerBalance(100n)
    vi.mocked(tooling.executeTransactionWithSummary).mockResolvedValue({
      summary: { label: "withdraw-trader-account" } as never
    })

    const result = await withdrawFromExistingTraderAccount({
      tooling,
      ammPackageId: "0x555",
      ammAdminCapId: "0xa11",
      coinType:
        "0x2::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>",
      amount: "25"
    })

    expect(result.coinType).toBe(normalizeSuiObjectId("0x2") + "::sui::SUI")
  })

  it("fails fast with a clear error when balance manager funds are insufficient", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: normalizeSuiAddress("0xabc"),
      balanceManagerId: "0x222",
      balanceManagerBalancesBagId: "0x333"
    })
    mockBalanceManagerBalance(10n)

    await expect(
      withdrawFromExistingTraderAccount({
        tooling,
        ammPackageId: "0x555",
        ammAdminCapId: "0xa11",
        coinType: SUI_COIN_TYPE,
        amount: "25"
      })
    ).rejects.toThrow(
      `Trader account 0x111 has insufficient ${SUI_COIN_TYPE} balance in balance manager 0x222: requested 25, available 10. Fund the trader account before withdrawing.`
    )
    expect(executeTransactionWithSummary).not.toHaveBeenCalled()
  })

  it("rejects wrapped Coin<T> inputs with unbalanced generic brackets", async () => {
    const tooling = createTooling()
    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")

    await expect(
      withdrawFromExistingTraderAccount({
        tooling,
        ammPackageId: "0x555",
        ammAdminCapId: "0xa11",
        coinType: "0x2::coin::Coin<0x2::sui::SUI",
        amount: "25"
      })
    ).rejects.toThrow(
      "Withdrawal coin type 0x2::coin::Coin<0x2::sui::SUI is missing a valid asset type argument."
    )
  })

  it("rejects wrapped Coin<T> inputs with trailing tokens", async () => {
    const tooling = createTooling()
    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")

    await expect(
      withdrawFromExistingTraderAccount({
        tooling,
        ammPackageId: "0x555",
        ammAdminCapId: "0xa11",
        coinType: "0x2::coin::Coin<0x2::sui::SUI> ::extra",
        amount: "25"
      })
    ).rejects.toThrow(
      "Withdrawal coin type 0x2::coin::Coin<0x2::sui::SUI> ::extra is missing a valid asset type argument."
    )
  })

  it("fails when no owned trader account exists for the signer", async () => {
    const tooling = createTooling()
    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue(undefined)

    await expect(
      withdrawFromExistingTraderAccount({
        tooling,
        ammPackageId: "0x555",
        ammAdminCapId: "0xa11",
        coinType: "0x2::sui::SUI",
        amount: "25"
      })
    ).rejects.toThrow("No owned trader account was found for the active signer")
  })

  it("returns a dry-run status with a fallback summary label", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: normalizeSuiAddress("0xabc"),
      balanceManagerId: "0x222",
      balanceManagerBalancesBagId: "0x333"
    })
    mockBalanceManagerBalance(100n)
    executeTransactionWithSummary.mockResolvedValue({})

    const result = await withdrawFromExistingTraderAccount({
      tooling,
      ammPackageId: "0x555",
      ammAdminCapId: "0xa11",
      coinType: "0x2::sui::SUI",
      amount: "25",
      dryRun: true
    })

    expect(result.status).toBe("dry-run")
    expect(result.transactionSummaries.withdrawTraderAccount?.label).toBe(
      "withdraw-trader-account"
    )
  })
})
