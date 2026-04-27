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
const EXECUTOR_TYPE = `${AMM_PACKAGE_ID}::executor::Executor`

const buildMoveObject = (
  fields: Record<string, unknown>,
  { type = EXECUTOR_TYPE }: { type?: string } = {}
) =>
  ({
    objectId: "0xtrader",
    type,
    content: {
      dataType: "moveObject",
      fields
    }
  }) as never

// 32-byte Pyth feed identifier bytes used in fixtures; the model formats them
// back as `0x...` hex.
const BASE_FEED_ID_BYTES = Array.from({ length: 32 }, (_, index) => index)
const QUOTE_FEED_ID_BYTES = Array.from(
  { length: 32 },
  (_, index) => 0xff - index
)
const BASE_FEED_ID_HEX = `0x${BASE_FEED_ID_BYTES.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
const QUOTE_FEED_ID_HEX = `0x${QUOTE_FEED_ID_BYTES.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`

const POOL_ID = normalizeSuiObjectId("0xpool")
const BASE_COIN_ADDRESS = normalizeSuiObjectId("0x2")
const QUOTE_COIN_ADDRESS = normalizeSuiObjectId("0xusdc")
const BASE_COIN_TYPE = `${BASE_COIN_ADDRESS}::sui::SUI`
const QUOTE_COIN_TYPE = `${QUOTE_COIN_ADDRESS}::usdc::USDC`

const buildMarketFields = () => ({
  market: {
    fields: {
      pool_id: POOL_ID,
      base: {
        fields: {
          coin_type: { fields: { name: BASE_COIN_TYPE } },
          decimals: 9,
          pyth_price_feed_id: BASE_FEED_ID_BYTES
        }
      },
      quote: {
        fields: {
          coin_type: { fields: { name: QUOTE_COIN_TYPE } },
          decimals: 6,
          pyth_price_feed_id: QUOTE_FEED_ID_BYTES
        }
      }
    }
  },
  info: {
    fields: {
      volume_base: "7",
      base: {
        fields: {
          balance: "10",
          deposited: "30",
          withdrawn: "5"
        }
      },
      quote: {
        fields: {
          balance: "20",
          deposited: "40",
          withdrawn: "6"
        }
      }
    }
  },
  active: true
})

const expectedMarketOverviewSlice = {
  active: true,
  baseCoinType: BASE_COIN_TYPE,
  quoteCoinType: QUOTE_COIN_TYPE,
  baseDecimals: 9,
  quoteDecimals: 6,
  basePythPriceFeedIdHex: BASE_FEED_ID_HEX,
  quotePythPriceFeedIdHex: QUOTE_FEED_ID_HEX,
  poolId: POOL_ID,
  baseBalance: "10",
  quoteBalance: "20",
  baseDeposited: "30",
  quoteDeposited: "40",
  baseWithdrawn: "5",
  quoteWithdrawn: "6",
  volumeBase: "7"
}

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
        },
        ...buildMarketFields()
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
      withdrawCapId: normalizeSuiObjectId("0xwithdraw"),
      ...expectedMarketOverviewSlice
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
        },
        ...buildMarketFields()
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
      withdrawCapId: normalizeSuiObjectId("0xwithdraw"),
      ...expectedMarketOverviewSlice
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
      'Object 0xtrader has unexpected type "0xother::foo::Bar"; expected "0xamm::executor::Executor" (likely wrong package id or not a market maker executor object).'
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
