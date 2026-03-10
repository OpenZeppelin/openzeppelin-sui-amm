import { describe, expect, it } from "vitest"
import {
  dedupeEntriesByKey,
  mergeObjectCollections
} from "../../src/utils/object.ts"

describe("dedupeEntriesByKey", () => {
  it("keeps the latest keyed entry while preserving unkeyed entries", () => {
    const deduped = dedupeEntriesByKey(
      [
        { id: "a", value: 1 },
        { value: 2 },
        { id: "a", value: 3 },
        { id: "b", value: 4 }
      ],
      (entry) =>
        "id" in entry && typeof entry.id === "string" ? entry.id : undefined
    )

    expect(deduped).toEqual([
      { value: 2 },
      { id: "a", value: 3 },
      { id: "b", value: 4 }
    ])
  })
})

describe("mergeObjectCollections", () => {
  it("shallow merges objects when no collection rules are provided", () => {
    const merged = mergeObjectCollections(
      { packageId: "0x1", packageName: "old" },
      { packageName: "new" }
    )

    expect(merged).toEqual({ packageId: "0x1", packageName: "new" })
  })

  it("appends and dedupes configured collections while keeping latest entries", () => {
    const merged = mergeObjectCollections(
      {
        coins: [
          {
            label: "USDC",
            coinType: "0x1::usdc::USDC",
            currencyObjectId: "0x1"
          }
        ],
        priceFeeds: [
          {
            label: "BTC/USD",
            feedIdHex: "0xfeed-1",
            priceInfoObjectId: "0xa"
          }
        ]
      },
      {
        coins: [
          {
            label: "USDC",
            coinType: "0x1::usdc::USDC",
            currencyObjectId: "0x2"
          },
          {
            label: "SUI",
            coinType: "0x2::sui::SUI",
            currencyObjectId: "0x3"
          }
        ],
        priceFeeds: [
          {
            label: "BTC/USD",
            feedIdHex: "0xfeed-1",
            priceInfoObjectId: "0xb"
          },
          {
            label: "ETH/USD",
            feedIdHex: "0xfeed-2",
            priceInfoObjectId: "0xc"
          }
        ]
      },
      {
        coins: (coin) => {
          if (!coin || typeof coin !== "object") return undefined
          const record = coin as Record<string, unknown>
          if (typeof record.coinType === "string") {
            return `coinType:${record.coinType}`
          }
          if (typeof record.label === "string") return `label:${record.label}`
          return undefined
        },
        priceFeeds: (priceFeed) => {
          if (!priceFeed || typeof priceFeed !== "object") return undefined
          const record = priceFeed as Record<string, unknown>
          if (typeof record.feedIdHex === "string") {
            return `feedIdHex:${record.feedIdHex}`
          }
          if (typeof record.label === "string") return `label:${record.label}`
          return undefined
        }
      }
    )

    expect(merged).toEqual({
      coins: [
        {
          label: "USDC",
          coinType: "0x1::usdc::USDC",
          currencyObjectId: "0x2"
        },
        {
          label: "SUI",
          coinType: "0x2::sui::SUI",
          currencyObjectId: "0x3"
        }
      ],
      priceFeeds: [
        {
          label: "BTC/USD",
          feedIdHex: "0xfeed-1",
          priceInfoObjectId: "0xb"
        },
        {
          label: "ETH/USD",
          feedIdHex: "0xfeed-2",
          priceInfoObjectId: "0xc"
        }
      ]
    })
  })
})
