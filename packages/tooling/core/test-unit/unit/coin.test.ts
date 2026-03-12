import { describe, expect, it, vi } from "vitest"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  buildCoinTransferTransaction,
  fetchCoinBalances,
  normalizeCoinType,
  resolveCoinOwnership,
  selectRichestCoin
} from "../../src/coin.ts"
import { SUI_COIN_TYPE } from "../../src/constants.ts"
import { createSuiClientMock } from "../../../tests-integration/helpers/sui.ts"

describe("coin helpers", () => {
  it("normalizes coin types", () => {
    expect(normalizeCoinType("0x2::sui::SUI")).toBe(
      `${normalizeSuiObjectId("0x2")}::sui::SUI`
    )
    expect(() => normalizeCoinType("")).toThrow("coinType cannot be empty.")
  })

  it("builds a coin transfer transaction", () => {
    const transaction = buildCoinTransferTransaction({
      coinObjectId: "0x1",
      amount: 10n,
      recipientAddress: "0x2"
    })

    expect(transaction).toBeDefined()
  })

  it("selects the richest coin by balance", () => {
    expect(
      selectRichestCoin([
        { coinObjectId: "0x1", balance: 10n },
        { coinObjectId: "0x2", balance: 15n },
        { coinObjectId: "0x3", balance: 12n }
      ])
    ).toEqual({
      coinObjectId: "0x2",
      balance: 15n
    })
  })

  it("fetches SUI coin balances by default", async () => {
    const { client, mocks } = createSuiClientMock({
      getCoins: vi.fn().mockResolvedValue({
        data: [
          {
            coinObjectId: "0x2",
            balance: "42"
          }
        ],
        hasNextPage: false,
        nextCursor: null
      })
    })

    await expect(
      fetchCoinBalances({ owner: "0x1" }, { suiClient: client })
    ).resolves.toEqual([
      {
        coinObjectId: normalizeSuiObjectId("0x2"),
        balance: 42n
      }
    ])

    expect(mocks.getCoins).toHaveBeenCalledWith({
      owner: "0x1",
      coinType: normalizeCoinType(SUI_COIN_TYPE),
      limit: 50,
      cursor: undefined
    })
  })

  it("fetches coin balances for an explicit coin type", async () => {
    const explicitCoinType = " 0x1::usdc::USDC "
    const { client, mocks } = createSuiClientMock()

    await fetchCoinBalances(
      { owner: "0x1", coinType: explicitCoinType },
      { suiClient: client }
    )

    expect(mocks.getCoins).toHaveBeenCalledWith({
      owner: "0x1",
      coinType: normalizeCoinType(explicitCoinType),
      limit: 50,
      cursor: undefined
    })
  })

  it("fetches coin balances across multiple pages", async () => {
    const { client, mocks } = createSuiClientMock({
      getCoins: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              coinObjectId: "0x2",
              balance: "10"
            }
          ],
          hasNextPage: true,
          nextCursor: "cursor-1"
        })
        .mockResolvedValueOnce({
          data: [
            {
              coinObjectId: "0x3",
              balance: "20"
            }
          ],
          hasNextPage: false,
          nextCursor: null
        })
    })

    await expect(
      fetchCoinBalances({ owner: "0x1" }, { suiClient: client })
    ).resolves.toEqual([
      {
        coinObjectId: normalizeSuiObjectId("0x2"),
        balance: 10n
      },
      {
        coinObjectId: normalizeSuiObjectId("0x3"),
        balance: 20n
      }
    ])

    expect(mocks.getCoins).toHaveBeenNthCalledWith(1, {
      owner: "0x1",
      coinType: normalizeCoinType(SUI_COIN_TYPE),
      limit: 50,
      cursor: undefined
    })

    expect(mocks.getCoins).toHaveBeenNthCalledWith(2, {
      owner: "0x1",
      coinType: normalizeCoinType(SUI_COIN_TYPE),
      limit: 50,
      cursor: "cursor-1"
    })
  })

  it("resolves coin ownership from object responses", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: {
          type: "0x2::coin::Coin<0x2::sui::SUI>",
          owner: { AddressOwner: "0x2" }
        },
        error: undefined
      })
    })

    const ownership = await resolveCoinOwnership(
      { coinObjectId: "0x1" },
      { suiClient: client }
    )

    expect(ownership.coinType).toBe("0x2::coin::Coin<0x2::sui::SUI>")
    expect(ownership.ownerAddress).toBe(normalizeSuiAddress("0x2"))
  })
})
