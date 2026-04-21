import { beforeEach, describe, expect, it, vi } from "vitest"

const traderAccountModelMocks = vi.hoisted(() => ({
  findOwnedTraderAccountIds: vi.fn(),
  getTraderAccountOverview: vi.fn(),
  resolveTraderAccountType: vi.fn()
}))

vi.mock("@sui-amm/domain-core/models/traderAccount", () => ({
  findOwnedTraderAccountIds: traderAccountModelMocks.findOwnedTraderAccountIds,
  getTraderAccountOverview: traderAccountModelMocks.getTraderAccountOverview,
  resolveTraderAccountType: traderAccountModelMocks.resolveTraderAccountType
}))

import { resolveTraderAccount } from "../deepbook-registration.ts"

type TraderAccountTooling = Parameters<
  typeof resolveTraderAccount
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
    suiClient: {}
  }) as unknown as TraderAccountTooling

describe("resolveTraderAccount", () => {
  beforeEach(() => {
    traderAccountModelMocks.findOwnedTraderAccountIds.mockReset()
    traderAccountModelMocks.getTraderAccountOverview.mockReset()
    traderAccountModelMocks.resolveTraderAccountType.mockReset()
    traderAccountModelMocks.resolveTraderAccountType.mockImplementation(
      (packageId: string) => `${packageId}::executor::MarketMaker`
    )
  })

  it("returns the owned market maker when exactly one exists", async () => {
    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([
      "0xtrader"
    ])
    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue(
      buildTraderAccountOverview("0xtrader")
    )

    const result = await resolveTraderAccount({
      tooling: createTooling(),
      ammPackageId: "0xamm",
      ownerAddress: "0xowner"
    })

    expect(
      traderAccountModelMocks.findOwnedTraderAccountIds
    ).toHaveBeenCalledWith({
      ownerAddress: "0xowner",
      packageId: "0xamm",
      suiClient: expect.anything()
    })
    expect(result.traderAccount.traderAccountId).toBe("0xtrader")
  })

  it("fails clearly when multiple owned market makers exist and none is specified", async () => {
    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([
      "0xtrader-a",
      "0xtrader-b"
    ])

    await expect(
      resolveTraderAccount({
        tooling: createTooling(),
        ammPackageId: "0xamm",
        ownerAddress: "0xowner"
      })
    ).rejects.toThrow(
      "Multiple owned market makers were found for the active owner (2). Provide --trader-account-id to choose one explicitly."
    )
  })

  it("errors with a pointer to amm-create when no market maker exists", async () => {
    traderAccountModelMocks.findOwnedTraderAccountIds.mockResolvedValue([])

    await expect(
      resolveTraderAccount({
        tooling: createTooling(),
        ammPackageId: "0xamm",
        ownerAddress: "0xowner"
      })
    ).rejects.toThrow(
      "No market maker found for owner 0xowner on package 0xamm. Run amm-create to create one, then re-run this script."
    )
  })

  it("uses an explicit market maker id without owned-account discovery", async () => {
    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue(
      buildTraderAccountOverview("0xexplicit")
    )

    const result = await resolveTraderAccount({
      tooling: createTooling(),
      ammPackageId: "0xamm",
      ownerAddress: "0xowner",
      traderAccountId: "0xexplicit"
    })

    expect(result.traderAccount.traderAccountId).toBe("0xexplicit")
    expect(
      traderAccountModelMocks.findOwnedTraderAccountIds
    ).not.toHaveBeenCalled()
  })

  it("wraps model lookup failures with actionable context", async () => {
    traderAccountModelMocks.getTraderAccountOverview.mockRejectedValue(
      new Error("Object not found")
    )

    await expect(
      resolveTraderAccount({
        tooling: createTooling(),
        ammPackageId: "0xamm",
        ownerAddress: "0xowner",
        traderAccountId: "0xexplicit"
      })
    ).rejects.toThrow(
      "Market maker lookup failed for traderAccountId 0xexplicit (expected owner 0xowner, expected package 0xamm, expected type 0xamm::executor::MarketMaker). Cause: Object not found"
    )
  })

  it("fails with clear context when the market maker owner mismatches", async () => {
    traderAccountModelMocks.getTraderAccountOverview.mockResolvedValue({
      ...buildTraderAccountOverview("0xexplicit"),
      ownerAddress: "0xanother-owner"
    })

    await expect(
      resolveTraderAccount({
        tooling: createTooling(),
        ammPackageId: "0xamm",
        ownerAddress: "0xowner",
        traderAccountId: "0xexplicit"
      })
    ).rejects.toThrow(
      "Market maker owner mismatch for traderAccountId 0xexplicit. Expected owner 0xowner, found 0xanother-owner, expected package 0xamm."
    )
  })
})
