import { describe, expect, it } from "vitest"

import {
  buildCreateExecutorTransaction,
  buildUpdateConfigTransaction,
  buildUpdateMarketTransaction,
  buildUpdateMarketWithPauseTransaction
} from "@sui-amm/domain-core/ptb/amm"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"

const expectMoveCall = (
  command: ReturnType<
    ReturnType<typeof buildCreateExecutorTransaction>["getData"]
  >["commands"][number]
) => {
  expect(command.$kind).toBe("MoveCall")
  if (command.$kind !== "MoveCall") {
    throw new Error("Expected MoveCall command.")
  }

  return command.MoveCall
}

const FEED_BYTES = Array.from({ length: 32 }, (_, index) => index)

const BASE_ASSET_TYPE_TAG =
  "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
const QUOTE_ASSET_TYPE_TAG =
  "0x0000000000000000000000000000000000000000000000000000000000000abc::usdc::USDC"

const EXECUTOR: WrappedSuiSharedObject = {
  object: {
    objectId: "0x789",
    version: "7",
    digest: "digest"
  },
  sharedRef: {
    objectId: "0x789",
    initialSharedVersion: "5",
    mutable: true
  }
} as WrappedSuiSharedObject

const POOL: WrappedSuiSharedObject = {
  object: {
    objectId: "0x456",
    version: "3",
    digest: "digest"
  },
  sharedRef: {
    objectId: "0x456",
    initialSharedVersion: "2",
    mutable: false
  }
} as WrappedSuiSharedObject

const CURRENT_POOL: WrappedSuiSharedObject = {
  object: {
    objectId: "0xaaa",
    version: "11",
    digest: "digest"
  },
  sharedRef: {
    objectId: "0xaaa",
    initialSharedVersion: "9",
    mutable: true
  }
} as WrappedSuiSharedObject

const BASE_CURRENCY: WrappedSuiSharedObject = {
  object: {
    objectId: "0xb00",
    version: "1",
    digest: "digest"
  },
  sharedRef: {
    objectId: "0xb00",
    initialSharedVersion: "1",
    mutable: false
  }
} as WrappedSuiSharedObject

const QUOTE_CURRENCY: WrappedSuiSharedObject = {
  object: {
    objectId: "0xc00",
    version: "1",
    digest: "digest"
  },
  sharedRef: {
    objectId: "0xc00",
    initialSharedVersion: "1",
    mutable: false
  }
} as WrappedSuiSharedObject

describe("amm PTB builders", () => {
  it("builds create with market::new + config::new + executor::create + share + transfer", () => {
    const transaction = buildCreateExecutorTransaction({
      packageId: "0x123",
      pool: POOL,
      baseCurrency: BASE_CURRENCY,
      quoteCurrency: QUOTE_CURRENCY,
      baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
      quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
      senderAddress: "0x789",
      baseSpreadBps: 25n,
      volatilitySpreadBps: 200n,
      basePythPriceFeedIdBytes: FEED_BYTES,
      quotePythPriceFeedIdBytes: FEED_BYTES,
      orderExpirationTimeMs: 86400000n,
      maxPriceAgeSecs: 60n,
      maxConfRatioBps: 1000n,
      outerBalanceBps: 5000n
    })

    const transactionData = transaction.getData()
    expect(transactionData.commands).toHaveLength(5)

    const marketCall = expectMoveCall(transactionData.commands[0])
    expect(marketCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "market",
      function: "new"
    })
    expect(marketCall.typeArguments).toEqual([
      BASE_ASSET_TYPE_TAG,
      QUOTE_ASSET_TYPE_TAG
    ])

    const configCall = expectMoveCall(transactionData.commands[1])
    expect(configCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "config",
      function: "new"
    })

    const createCall = expectMoveCall(transactionData.commands[2])
    expect(createCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "create"
    })

    const shareCall = expectMoveCall(transactionData.commands[3])
    expect(shareCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      module: "transfer",
      function: "public_share_object"
    })

    expect(transactionData.commands[4].$kind).toBe("TransferObjects")
  })

  it("rejects create when a feed id bytes array is not 32 bytes", () => {
    expect(() =>
      buildCreateExecutorTransaction({
        packageId: "0x123",
        pool: POOL,
        baseCurrency: BASE_CURRENCY,
        quoteCurrency: QUOTE_CURRENCY,
        baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
        quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
        senderAddress: "0x789",
        baseSpreadBps: 25n,
        volatilitySpreadBps: 200n,
        basePythPriceFeedIdBytes: "0xfeed" as unknown as number[],
        quotePythPriceFeedIdBytes: FEED_BYTES,
        orderExpirationTimeMs: 86400000n,
        maxPriceAgeSecs: 60n,
        maxConfRatioBps: 1000n,
        outerBalanceBps: 5000n
      })
    ).toThrowError(
      new TypeError("basePythPriceFeedIdBytes must be a 32-byte array.")
    )
  })

  it("builds update config with config::new + executor::update_config", () => {
    const transaction = buildUpdateConfigTransaction({
      packageId: "0x123",
      executor: EXECUTOR,
      adminCapId: "0x456",
      baseSpreadBps: 25n,
      volatilitySpreadBps: 200n,
      orderExpirationTimeMs: 86400000n,
      maxPriceAgeSecs: 60n,
      maxConfRatioBps: 1000n,
      outerBalanceBps: 5000n
    })

    const transactionData = transaction.getData()
    expect(transactionData.commands).toHaveLength(2)

    const configCall = expectMoveCall(transactionData.commands[0])
    expect(configCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "config",
      function: "new"
    })

    const updateCall = expectMoveCall(transactionData.commands[1])
    expect(updateCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "update_config"
    })
    expect(updateCall.arguments[0]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
    expect(updateCall.arguments[1]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
  })

  it("builds update market with market::new + executor::update_market", () => {
    const transaction = buildUpdateMarketTransaction({
      packageId: "0x123",
      executor: EXECUTOR,
      adminCapId: "0x456",
      pool: POOL,
      baseCurrency: BASE_CURRENCY,
      quoteCurrency: QUOTE_CURRENCY,
      baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
      quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
      basePythPriceFeedIdBytes: FEED_BYTES,
      quotePythPriceFeedIdBytes: FEED_BYTES
    })

    const transactionData = transaction.getData()
    expect(transactionData.commands).toHaveLength(2)

    const marketCall = expectMoveCall(transactionData.commands[0])
    expect(marketCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "market",
      function: "new"
    })
    expect(marketCall.typeArguments).toEqual([
      BASE_ASSET_TYPE_TAG,
      QUOTE_ASSET_TYPE_TAG
    ])

    const updateCall = expectMoveCall(transactionData.commands[1])
    expect(updateCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "update_market"
    })
    expect(updateCall.arguments[0]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
    expect(updateCall.arguments[1]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
  })

  it("rejects update market when a feed id bytes array is not 32 bytes long", () => {
    expect(() =>
      buildUpdateMarketTransaction({
        packageId: "0x123",
        executor: EXECUTOR,
        adminCapId: "0x456",
        pool: POOL,
        baseCurrency: BASE_CURRENCY,
        quoteCurrency: QUOTE_CURRENCY,
        baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
        quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
        basePythPriceFeedIdBytes: FEED_BYTES,
        quotePythPriceFeedIdBytes: Array.from({ length: 31 }, (_, i) => i)
      })
    ).toThrowError(
      new TypeError("quotePythPriceFeedIdBytes must be a 32-byte array.")
    )
  })

  it("builds update market with pause → market::new → update_market → unpause when active", () => {
    const transaction = buildUpdateMarketWithPauseTransaction({
      packageId: "0x123",
      executor: EXECUTOR,
      adminCapId: "0x456",
      currentActive: true,
      currentPool: CURRENT_POOL,
      pool: POOL,
      baseCurrency: BASE_CURRENCY,
      quoteCurrency: QUOTE_CURRENCY,
      baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
      quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
      basePythPriceFeedIdBytes: FEED_BYTES,
      quotePythPriceFeedIdBytes: FEED_BYTES
    })

    const transactionData = transaction.getData()
    expect(transactionData.commands).toHaveLength(4)

    const pauseCall = expectMoveCall(transactionData.commands[0])
    expect(pauseCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "pause"
    })
    expect(pauseCall.typeArguments).toEqual([
      BASE_ASSET_TYPE_TAG,
      QUOTE_ASSET_TYPE_TAG
    ])

    const marketCall = expectMoveCall(transactionData.commands[1])
    expect(marketCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "market",
      function: "new"
    })
    expect(marketCall.typeArguments).toEqual([
      BASE_ASSET_TYPE_TAG,
      QUOTE_ASSET_TYPE_TAG
    ])

    const updateCall = expectMoveCall(transactionData.commands[2])
    expect(updateCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "update_market"
    })

    const unpauseCall = expectMoveCall(transactionData.commands[3])
    expect(unpauseCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "unpause"
    })
  })

  it("builds update market without pause/unpause when paused", () => {
    const transaction = buildUpdateMarketWithPauseTransaction({
      packageId: "0x123",
      executor: EXECUTOR,
      adminCapId: "0x456",
      currentActive: false,
      currentPool: CURRENT_POOL,
      pool: POOL,
      baseCurrency: BASE_CURRENCY,
      quoteCurrency: QUOTE_CURRENCY,
      baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
      quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
      basePythPriceFeedIdBytes: FEED_BYTES,
      quotePythPriceFeedIdBytes: FEED_BYTES
    })

    const transactionData = transaction.getData()
    expect(transactionData.commands).toHaveLength(2)

    const marketCall = expectMoveCall(transactionData.commands[0])
    expect(marketCall).toMatchObject({
      module: "market",
      function: "new"
    })

    const updateCall = expectMoveCall(transactionData.commands[1])
    expect(updateCall).toMatchObject({
      module: "executor",
      function: "update_market"
    })
  })

  it("rejects update market with pause when a feed id bytes array is not 32 bytes", () => {
    expect(() =>
      buildUpdateMarketWithPauseTransaction({
        packageId: "0x123",
        executor: EXECUTOR,
        adminCapId: "0x456",
        currentActive: true,
        currentPool: CURRENT_POOL,
        pool: POOL,
        baseCurrency: BASE_CURRENCY,
        quoteCurrency: QUOTE_CURRENCY,
        baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
        quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
        basePythPriceFeedIdBytes: Array.from({ length: 31 }, (_, i) => i),
        quotePythPriceFeedIdBytes: FEED_BYTES
      })
    ).toThrowError(
      new TypeError("basePythPriceFeedIdBytes must be a 32-byte array.")
    )
  })
})
