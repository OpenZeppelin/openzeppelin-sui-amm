import { describe, expect, it } from "vitest"

import {
  buildCreateMarketMakerTransaction,
  buildUpdateMarketMakerTransaction
} from "@sui-amm/domain-core/ptb/amm"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"

const expectMoveCall = (
  command: ReturnType<
    ReturnType<typeof buildCreateMarketMakerTransaction>["getData"]
  >["commands"][number]
) => {
  expect(command.$kind).toBe("MoveCall")
  if (command.$kind !== "MoveCall") {
    throw new Error("Expected MoveCall command.")
  }

  return command.MoveCall
}

const FEED_BYTES = Array.from({ length: 32 }, (_, index) => index)

describe("amm PTB builders", () => {
  it("builds create with config::new + executor::create + share + transfer", () => {
    const transaction = buildCreateMarketMakerTransaction({
      packageId: "0x123",
      poolId: "0x456",
      senderAddress: "0x789",
      baseSpreadBps: 25n,
      volatilitySpreadBps: 200n,
      basePythPriceFeedIdBytes: FEED_BYTES,
      quotePythPriceFeedIdBytes: FEED_BYTES,
      orderExpirationTimeMs: 86400000n,
      maxPriceAgeSecs: 60n,
      maxConfRatioBps: 1000n
    })

    const transactionData = transaction.getData()
    expect(transactionData.commands).toHaveLength(4)

    const configCall = expectMoveCall(transactionData.commands[0])
    expect(configCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "config",
      function: "new"
    })

    const createCall = expectMoveCall(transactionData.commands[1])
    expect(createCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "create"
    })

    const shareCall = expectMoveCall(transactionData.commands[2])
    expect(shareCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      module: "transfer",
      function: "public_share_object"
    })

    expect(transactionData.commands[3].$kind).toBe("TransferObjects")
  })

  it("rejects create when a feed id bytes array is not 32 bytes", () => {
    expect(() =>
      buildCreateMarketMakerTransaction({
        packageId: "0x123",
        poolId: "0x456",
        senderAddress: "0x789",
        baseSpreadBps: 25n,
        volatilitySpreadBps: 200n,
        basePythPriceFeedIdBytes: "0xfeed" as unknown as number[],
        quotePythPriceFeedIdBytes: FEED_BYTES,
        orderExpirationTimeMs: 86400000n,
        maxPriceAgeSecs: 60n,
        maxConfRatioBps: 1000n
      })
    ).toThrowError(
      new TypeError("basePythPriceFeedIdBytes must be a 32-byte array.")
    )
  })

  it("builds update with config::new + executor::update_market_maker", () => {
    const marketMaker = {
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

    const transaction = buildUpdateMarketMakerTransaction({
      packageId: "0x123",
      marketMaker,
      adminCapId: "0x456",
      poolId: "0xabc",
      baseSpreadBps: 25n,
      volatilitySpreadBps: 200n,
      basePythPriceFeedIdBytes: FEED_BYTES,
      quotePythPriceFeedIdBytes: FEED_BYTES,
      orderExpirationTimeMs: 86400000n,
      maxPriceAgeSecs: 60n,
      maxConfRatioBps: 1000n
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
      function: "update_market_maker"
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

  it("rejects update when a feed id bytes array is not 32 bytes long", () => {
    const marketMaker = {
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

    expect(() =>
      buildUpdateMarketMakerTransaction({
        packageId: "0x123",
        marketMaker,
        adminCapId: "0x456",
        poolId: "0xabc",
        baseSpreadBps: 25n,
        volatilitySpreadBps: 200n,
        basePythPriceFeedIdBytes: FEED_BYTES,
        quotePythPriceFeedIdBytes: Array.from({ length: 31 }, (_, i) => i),
        orderExpirationTimeMs: 86400000n,
        maxPriceAgeSecs: 60n,
        maxConfRatioBps: 1000n
      })
    ).toThrowError(
      new TypeError("quotePythPriceFeedIdBytes must be a 32-byte array.")
    )
  })
})
