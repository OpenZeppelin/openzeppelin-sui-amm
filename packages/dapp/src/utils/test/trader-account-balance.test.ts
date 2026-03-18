import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import { beforeEach, describe, expect, it, vi } from "vitest"

const traderAccountMocks = vi.hoisted(() => ({
  resolveOwnedTraderAccountId: vi.fn(),
  getOwnedTraderAccountOverview: vi.fn()
}))

const domainTraderAccountMocks = vi.hoisted(() => ({
  getBalanceManagerAssetBalances: vi.fn()
}))

vi.mock("@sui-amm/domain-core/models/traderAccount", async () => {
  const actual = await vi.importActual(
    "@sui-amm/domain-core/models/traderAccount"
  )

  return {
    ...actual,
    getBalanceManagerAssetBalances:
      domainTraderAccountMocks.getBalanceManagerAssetBalances
  }
})

vi.mock("../trader-account.ts", () => ({
  resolveOwnedTraderAccountId: traderAccountMocks.resolveOwnedTraderAccountId,
  getOwnedTraderAccountOverview:
    traderAccountMocks.getOwnedTraderAccountOverview
}))

import { viewExistingTraderAccountBalance } from "../trader-account-balance.ts"

type BalanceTooling = Parameters<typeof viewExistingTraderAccountBalance>[0]["tooling"]

const createTooling = (): BalanceTooling =>
  ({
    loadedEd25519KeyPair: { toSuiAddress: () => "0xabc" },
    suiClient: {}
  }) as unknown as BalanceTooling

const NORMALIZED_SUI_COIN_TYPE = `${normalizeSuiObjectId("0x2")}::sui::SUI`
const NORMALIZED_USDC_COIN_TYPE =
  "0x1111111111111111111111111111111111111111111111111111111111111111::coins::USDC"

describe("viewExistingTraderAccountBalance", () => {
  beforeEach(() => {
    traderAccountMocks.resolveOwnedTraderAccountId.mockReset()
    traderAccountMocks.getOwnedTraderAccountOverview.mockReset()
    domainTraderAccountMocks.getBalanceManagerAssetBalances.mockReset()
  })

  it("loads balance-manager assets and provides withdraw-ready fields", async () => {
    const tooling = createTooling()

    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue("0x111")
    traderAccountMocks.getOwnedTraderAccountOverview.mockResolvedValue({
      traderAccountId: "0x111",
      ownerAddress: normalizeSuiAddress("0xabc"),
      balanceManagerId: "0x222"
    })
    domainTraderAccountMocks.getBalanceManagerAssetBalances.mockResolvedValue([
      {
        coinType: "0x2::sui::SUI",
        balance: 42n
      },
      {
        coinType: NORMALIZED_USDC_COIN_TYPE,
        balance: 8n
      }
    ])

    const result = await viewExistingTraderAccountBalance({
      tooling,
      ammPackageId: "0x555"
    })

    expect(result.status).toBe("loaded")
    expect(result.ownerAddress).toBe(normalizeSuiAddress("0xabc"))
    expect(result.assets).toHaveLength(2)

    expect(result.assets[0]).toEqual({
      coinType: NORMALIZED_SUI_COIN_TYPE,
      balance: "42",
      withdrawArguments: {
        coinType: NORMALIZED_SUI_COIN_TYPE,
        amount: "42"
      },
      withdrawCommand:
        "pnpm dapp user:trader-account:withdraw --amm-package-id 0x555 --trader-account-id 0x111 --coin-type 0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI --amount 42"
    })
  })

  it("fails when no owned trader account exists for the signer", async () => {
    const tooling = createTooling()
    traderAccountMocks.resolveOwnedTraderAccountId.mockResolvedValue(undefined)

    await expect(
      viewExistingTraderAccountBalance({
        tooling,
        ammPackageId: "0x555"
      })
    ).rejects.toThrow("No owned trader account was found for the active signer")
  })
})
