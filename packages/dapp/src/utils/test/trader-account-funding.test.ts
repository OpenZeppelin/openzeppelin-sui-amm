import { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NORMALIZED_SUI_COIN_TYPE } from "@sui-amm/tooling-node/constants"

const traderAccountMocks = vi.hoisted(() => ({
  resolveOwnedTraderAccountId: vi.fn(),
  getOwnedTraderAccountOverview: vi.fn()
}))

const coinPlanningMocks = vi.hoisted(() => ({
  planSuiPaymentSplitTransaction: vi.fn()
}))

vi.mock("../trader-account.ts", () => ({
  resolveOwnedTraderAccountId: traderAccountMocks.resolveOwnedTraderAccountId,
  getOwnedTraderAccountOverview:
    traderAccountMocks.getOwnedTraderAccountOverview
}))

vi.mock("@sui-amm/tooling-core/coin", async (importOriginal) => ({
  ...(await importOriginal()),
  planSuiPaymentSplitTransaction:
    coinPlanningMocks.planSuiPaymentSplitTransaction
}))

import { fundExistingTraderAccount } from "../trader-account-funding.ts"

type FundingTooling = Parameters<typeof fundExistingTraderAccount>[0]["tooling"]

const NORMALIZED_SUI_COIN_OBJECT_TYPE = `${normalizeSuiObjectId(
  "0x2"
)}::coin::Coin<${NORMALIZED_SUI_COIN_TYPE}>`
const MOCK_ASSET_TYPE =
  "0x000000000000000000000000000000000000000000000000000000000000000a::mock::USD"
const MOCK_COIN_OBJECT_TYPE = `${normalizeSuiObjectId(
  "0x2"
)}::coin::Coin<${MOCK_ASSET_TYPE}>`

const createTooling = (): FundingTooling =>
  ({
    executeTransactionWithSummary: vi.fn(),
    getMutableSharedObject: vi.fn(),
    loadedEd25519KeyPair: { toSuiAddress: () => "0xabc" },
    resolveCoinOwnership: vi.fn(),
    suiClient: {
      getCoins: vi.fn()
    },
    suiConfig: {
      network: {
        gasBudget: 100_000_000
      }
    }
  }) as unknown as FundingTooling

const expectMoveCall = (
  command: ReturnType<Transaction["getData"]>["commands"][number]
) => {
  expect(command.$kind).toBe("MoveCall")
  if (command.$kind !== "MoveCall") {
    throw new Error("Expected MoveCall command.")
  }

  return command.MoveCall
}

describe("fundExistingTraderAccount", () => {
  beforeEach(() => {
    traderAccountMocks.resolveOwnedTraderAccountId.mockReset()
    traderAccountMocks.getOwnedTraderAccountOverview.mockReset()
    coinPlanningMocks.planSuiPaymentSplitTransaction.mockReset()
  })

  it("funds an existing trader account with a non-SUI coin in a single transaction", async () => {
    const tooling = createTooling()
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getMutableSharedObject = vi.mocked(tooling.getMutableSharedObject)
    const resolveCoinOwnership = vi.mocked(tooling.resolveCoinOwnership)

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: "0xabc",
      balanceManagerId: "0x222"
    })
    resolveCoinOwnership.mockResolvedValue({
      coinType: MOCK_COIN_OBJECT_TYPE,
      ownerAddress: normalizeSuiObjectId("0xabc")
    })
    getMutableSharedObject.mockResolvedValue({
      sharedRef: {
        objectId: "0x222",
        initialSharedVersion: "1",
        mutable: true
      }
    } as never)
    executeTransactionWithSummary.mockResolvedValue({
      summary: { label: "fund-trader-account" } as never
    })

    const result = await fundExistingTraderAccount({
      tooling,
      ammPackageId: "0x555",
      coinObjectId: "0x333",
      amount: "25"
    })

    expect(result.status).toBe("funded")
    expect(result.coinObjectId).toBe(normalizeSuiObjectId("0x333"))
    expect(result.amount).toBe("25")
    expect(
      coinPlanningMocks.planSuiPaymentSplitTransaction
    ).not.toHaveBeenCalled()
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(1)

    const fundingTransaction =
      executeTransactionWithSummary.mock.calls[0]?.[0].transaction
    const fundingMoveCall = expectMoveCall(
      fundingTransaction.getData().commands[1] as never
    )

    expect(fundingTransaction.getData().commands).toHaveLength(2)
    expect(fundingMoveCall).toMatchObject({
      module: "executor",
      function: "fund_trader_account",
      typeArguments: [MOCK_ASSET_TYPE]
    })
  })

  it("rejects a funding coin that is not owned by the signer", async () => {
    const tooling = createTooling()
    const resolveCoinOwnership = vi.mocked(tooling.resolveCoinOwnership)

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: "0xabc",
      balanceManagerId: "0x222"
    })
    resolveCoinOwnership.mockResolvedValue({
      coinType: MOCK_COIN_OBJECT_TYPE,
      ownerAddress: "0xdef"
    })

    await expect(
      fundExistingTraderAccount({
        tooling,
        ammPackageId: "0x555",
        coinObjectId: "0x333",
        amount: "25"
      })
    ).rejects.toThrow(
      "Funding coin 0x0000000000000000000000000000000000000000000000000000000000000333 is not owned by signer 0x0000000000000000000000000000000000000000000000000000000000000abc"
    )
  })

  it("returns a dry-run note when SUI funding would require preparing a separate gas coin", async () => {
    const tooling = createTooling()
    const resolveCoinOwnership = vi.mocked(tooling.resolveCoinOwnership)
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getMutableSharedObject = vi.mocked(tooling.getMutableSharedObject)

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: "0xabc",
      balanceManagerId: "0x222"
    })
    resolveCoinOwnership.mockResolvedValue({
      coinType: NORMALIZED_SUI_COIN_OBJECT_TYPE,
      ownerAddress: normalizeSuiObjectId("0xabc")
    })
    getMutableSharedObject.mockResolvedValue({
      sharedRef: {
        objectId: "0x222",
        initialSharedVersion: "1",
        mutable: true
      }
    } as never)
    coinPlanningMocks.planSuiPaymentSplitTransaction.mockResolvedValue({
      needsSplit: true,
      paymentCoinObjectId: normalizeSuiObjectId("0x333"),
      transaction: new Transaction()
    })

    const result = await fundExistingTraderAccount({
      tooling,
      ammPackageId: "0x555",
      coinObjectId: "0x333",
      amount: "25",
      dryRun: true
    })

    expect(result.status).toBe("dry-run-sui-prepare-only")
    expect(result.note).toContain("separate gas coin")
    expect(result.transactionSummaries.prepareSuiGas?.label).toBe(
      "prepare-sui-gas-coin"
    )
    expect(result.transactionSummaries.fundTraderAccount).toBeUndefined()
    expect(executeTransactionWithSummary).not.toHaveBeenCalled()
  })

  it("prepares a SUI gas coin and then funds the trader account", async () => {
    const tooling = createTooling()
    const resolveCoinOwnership = vi.mocked(tooling.resolveCoinOwnership)
    const executeTransactionWithSummary = vi.mocked(
      tooling.executeTransactionWithSummary
    )
    const getMutableSharedObject = vi.mocked(tooling.getMutableSharedObject)

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: "0xabc",
      balanceManagerId: "0x222"
    })
    resolveCoinOwnership.mockResolvedValue({
      coinType: NORMALIZED_SUI_COIN_OBJECT_TYPE,
      ownerAddress: normalizeSuiObjectId("0xabc")
    })
    getMutableSharedObject.mockResolvedValue({
      sharedRef: {
        objectId: "0x222",
        initialSharedVersion: "1",
        mutable: true
      }
    } as never)
    coinPlanningMocks.planSuiPaymentSplitTransaction.mockResolvedValue({
      needsSplit: true,
      paymentCoinObjectId: normalizeSuiObjectId("0x333"),
      transaction: new Transaction()
    })
    executeTransactionWithSummary
      .mockResolvedValueOnce({
        execution: {
          objectArtifacts: {
            created: [
              {
                objectId: "0x444",
                objectType: NORMALIZED_SUI_COIN_OBJECT_TYPE,
                version: "2",
                digest: "gas-digest"
              }
            ]
          }
        } as never,
        summary: { label: "prepare-sui-gas-coin" } as never
      })
      .mockResolvedValueOnce({
        summary: { label: "fund-trader-account" } as never
      })

    const result = await fundExistingTraderAccount({
      tooling,
      ammPackageId: "0x555",
      coinObjectId: "0x333",
      amount: "25"
    })

    expect(result.status).toBe("funded")
    expect(executeTransactionWithSummary).toHaveBeenCalledTimes(2)

    const fundingTransaction =
      executeTransactionWithSummary.mock.calls[1]?.[0].transaction
    const fundingMoveCall = expectMoveCall(
      fundingTransaction.getData().commands[1] as never
    )

    expect(fundingMoveCall).toMatchObject({
      module: "executor",
      function: "fund_trader_account",
      typeArguments: [NORMALIZED_SUI_COIN_TYPE]
    })
    expect(fundingTransaction.getData().gasData.payment).toEqual([
      {
        objectId: normalizeSuiObjectId("0x444"),
        version: "2",
        digest: "gas-digest"
      }
    ])
  })
})
