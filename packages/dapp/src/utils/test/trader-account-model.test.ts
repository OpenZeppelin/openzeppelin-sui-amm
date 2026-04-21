import type * as ObjectModule from "@sui-amm/tooling-core/object"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { beforeEach, describe, expect, it, vi } from "vitest"

const objectMocks = vi.hoisted(() => ({
  getSuiObject: vi.fn(),
  getAllOwnedObjectsByFilter: vi.fn()
}))

vi.mock("@sui-amm/tooling-core/object", async (importOriginal) => ({
  ...(await importOriginal<typeof ObjectModule>()),
  getSuiObject: objectMocks.getSuiObject,
  getAllOwnedObjectsByFilter: objectMocks.getAllOwnedObjectsByFilter
}))

import {
  findOwnedTraderAccountIds,
  getTraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"

const AMM_PACKAGE_ID = "0xamm"
const MARKET_MAKER_TYPE = `${AMM_PACKAGE_ID}::executor::MarketMaker`

const buildMoveObject = (
  fields: Record<string, unknown>,
  { type = MARKET_MAKER_TYPE }: { type?: string } = {}
) =>
  ({
    objectId: "0xtrader",
    type,
    content: {
      dataType: "moveObject",
      fields
    }
  }) as never

describe("market maker model compatibility", () => {
  beforeEach(() => {
    objectMocks.getSuiObject.mockReset()
    objectMocks.getAllOwnedObjectsByFilter.mockReset()
  })

  it("parses the current market maker layout", async () => {
    objectMocks.getSuiObject.mockResolvedValue({
      owner: { AddressOwner: "0xowner" },
      object: buildMoveObject({
        balance_manager: {
          fields: {
            id: { id: "0xbalance" }
          }
        },
        caps: {
          fields: {
            trade_cap: { fields: { id: { id: "0xtrade" } } },
            deposit_cap: { fields: { id: { id: "0xdeposit" } } },
            withdraw_cap: { fields: { id: { id: "0xwithdraw" } } }
          }
        }
      })
    })

    const overview = await getTraderAccountOverview(
      "0xtrader",
      {} as never,
      AMM_PACKAGE_ID
    )

    expect(overview).toEqual({
      traderAccountId: normalizeSuiObjectId("0xtrader"),
      ownerAddress: normalizeSuiObjectId("0xowner"),
      balanceManagerId: normalizeSuiObjectId("0xbalance"),
      tradeCapId: normalizeSuiObjectId("0xtrade"),
      depositCapId: normalizeSuiObjectId("0xdeposit"),
      withdrawCapId: normalizeSuiObjectId("0xwithdraw")
    })
  })

  it("keeps compatibility with the legacy trader-account layout while the repo migrates", async () => {
    objectMocks.getSuiObject.mockResolvedValue({
      owner: { AddressOwner: "0xowner" },
      object: buildMoveObject({
        owner: "0xowner",
        balance_manager_id: "0xbalance",
        cap_ids: {
          fields: {
            trade_cap_id: "0xtrade",
            deposit_cap_id: "0xdeposit",
            withdraw_cap_id: "0xwithdraw"
          }
        }
      })
    })

    const overview = await getTraderAccountOverview(
      "0xtrader",
      {} as never,
      AMM_PACKAGE_ID
    )

    expect(overview).toEqual({
      traderAccountId: normalizeSuiObjectId("0xtrader"),
      ownerAddress: normalizeSuiObjectId("0xowner"),
      balanceManagerId: normalizeSuiObjectId("0xbalance"),
      tradeCapId: normalizeSuiObjectId("0xtrade"),
      depositCapId: normalizeSuiObjectId("0xdeposit"),
      withdrawCapId: normalizeSuiObjectId("0xwithdraw")
    })
  })

  it("rejects an object whose type does not match the expected market maker type", async () => {
    objectMocks.getSuiObject.mockResolvedValue({
      owner: { AddressOwner: "0xowner" },
      object: buildMoveObject(
        {
          balance_manager: { fields: { id: { id: "0xbalance" } } }
        },
        { type: "0xother::foo::Bar" }
      )
    })

    await expect(
      getTraderAccountOverview("0xtrader", {} as never, AMM_PACKAGE_ID)
    ).rejects.toThrow(
      'Object 0xtrader has unexpected type "0xother::foo::Bar"; expected "0xamm::executor::MarketMaker" (likely wrong package id or not a market maker object).'
    )
  })

  it("returns normalized owned trader-account ids in sorted order", async () => {
    objectMocks.getAllOwnedObjectsByFilter.mockResolvedValue([
      { objectId: "0x2" },
      { objectId: "0x1" },
      {}
    ])

    const traderAccountIds = await findOwnedTraderAccountIds({
      ownerAddress: "0xowner",
      packageId: "0xamm",
      suiClient: {} as never
    })

    expect(traderAccountIds).toEqual([
      normalizeSuiObjectId("0x1"),
      normalizeSuiObjectId("0x2")
    ])
  })
})
