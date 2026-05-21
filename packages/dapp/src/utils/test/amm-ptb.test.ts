import { describe, expect, it } from "vitest"

import { bcs } from "@mysten/sui/bcs"
import { fromBase64 } from "@mysten/sui/utils"
import {
  buildCreateExecutorTransaction,
  buildUpdateConfigAndCancelTransaction
} from "@sui-amm/domain-core/ptb/amm"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"

type TxData = ReturnType<
  ReturnType<typeof buildCreateExecutorTransaction>["getData"]
>
type TxInputs = TxData["inputs"]
type MoveCallArgs = NonNullable<
  Extract<TxData["commands"][number], { $kind: "MoveCall" }>["MoveCall"]
>["arguments"]

const expectMoveCall = (command: TxData["commands"][number]) => {
  expect(command.$kind).toBe("MoveCall")
  if (command.$kind !== "MoveCall") {
    throw new Error("Expected MoveCall command.")
  }

  return command.MoveCall
}

const resolvePureBytes = (
  inputs: TxInputs,
  args: MoveCallArgs,
  argIndex: number
): Uint8Array => {
  const arg = args[argIndex]
  expect(arg.$kind).toBe("Input")
  if (arg.$kind !== "Input") {
    throw new Error(`Expected Input at arg index ${argIndex}.`)
  }
  const input = inputs[arg.Input]
  expect(input.$kind).toBe("Pure")
  if (input.$kind !== "Pure") {
    throw new Error(`Expected Pure input for arg index ${argIndex}.`)
  }
  return fromBase64(input.Pure.bytes)
}

// `bcs.u64().parse` returns a string representation of the u64 (numbers can't
// safely represent the full u64 range). Tests compare via string equality.
const decodePureU64 = (
  inputs: TxInputs,
  args: MoveCallArgs,
  argIndex: number
): string => bcs.u64().parse(resolvePureBytes(inputs, args, argIndex))

const decodePureBool = (
  inputs: TxInputs,
  args: MoveCallArgs,
  argIndex: number
): boolean => bcs.bool().parse(resolvePureBytes(inputs, args, argIndex))

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
    // Unique per-arg values so any positional swap in `config::new` is caught
    // by the per-position assertions below.
    const baseSpreadBps = 25n
    const volatilityMultiplierBps = 12_345n
    const orderExpirationTimeMs = 86_400_001n
    const maxPriceAgeSecs = 31n
    const maxConfRatioBps = 1_001n
    const outerBalanceBps = 5_001n
    const inventorySkewBps = 100n
    const stalePriceToleranceBps = 7_000n
    const postOnly = true

    const transaction = buildCreateExecutorTransaction({
      packageId: "0x123",
      pool: POOL,
      baseCurrency: BASE_CURRENCY,
      quoteCurrency: QUOTE_CURRENCY,
      baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
      quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
      senderAddress: "0x789",
      baseSpreadBps,
      volatilityMultiplierBps,
      basePythPriceFeedIdBytes: FEED_BYTES,
      quotePythPriceFeedIdBytes: FEED_BYTES,
      orderExpirationTimeMs,
      maxPriceAgeSecs,
      maxConfRatioBps,
      outerBalanceBps,
      inventorySkewBps,
      stalePriceToleranceBps,
      postOnly
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

    // Guard the positional encoding of `config::new` arguments: a dropped or
    // reordered field would either change the count or shift a unique value
    // to a neighboring slot, failing one of these checks.
    const configArgs = configCall.arguments
    expect(configArgs).toHaveLength(9)
    expect(decodePureU64(transactionData.inputs, configArgs, 0)).toBe(
      baseSpreadBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 1)).toBe(
      volatilityMultiplierBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 2)).toBe(
      orderExpirationTimeMs.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 3)).toBe(
      maxPriceAgeSecs.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 4)).toBe(
      maxConfRatioBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 5)).toBe(
      outerBalanceBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 6)).toBe(
      inventorySkewBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 7)).toBe(
      stalePriceToleranceBps.toString()
    )
    expect(decodePureBool(transactionData.inputs, configArgs, 8)).toBe(postOnly)

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
        volatilityMultiplierBps: 10000n,
        basePythPriceFeedIdBytes: "0xfeed" as unknown as number[],
        quotePythPriceFeedIdBytes: FEED_BYTES,
        orderExpirationTimeMs: 86400000n,
        maxPriceAgeSecs: 60n,
        maxConfRatioBps: 1000n,
        outerBalanceBps: 5000n,
        inventorySkewBps: 0n,
        stalePriceToleranceBps: 0n,
        postOnly: true
      })
    ).toThrowError(
      new TypeError("basePythPriceFeedIdBytes must be a 32-byte array.")
    )
  })

  it("builds update config with config::new + update_config + cancel_orders_after_update", () => {
    // Unique per-arg values — same regression-catching rationale as the create test.
    const baseSpreadBps = 26n
    const volatilityMultiplierBps = 12_346n
    const orderExpirationTimeMs = 86_400_002n
    const maxPriceAgeSecs = 32n
    const maxConfRatioBps = 1_002n
    const outerBalanceBps = 5_002n
    const inventorySkewBps = 101n
    const stalePriceToleranceBps = 7_001n
    const postOnly = true

    const transaction = buildUpdateConfigAndCancelTransaction({
      packageId: "0x123",
      executor: EXECUTOR,
      adminCapId: "0x456",
      pool: POOL,
      baseAssetTypeTag: BASE_ASSET_TYPE_TAG,
      quoteAssetTypeTag: QUOTE_ASSET_TYPE_TAG,
      baseSpreadBps,
      volatilityMultiplierBps,
      orderExpirationTimeMs,
      maxPriceAgeSecs,
      maxConfRatioBps,
      outerBalanceBps,
      inventorySkewBps,
      stalePriceToleranceBps,
      postOnly
    })

    const transactionData = transaction.getData()
    expect(transactionData.commands).toHaveLength(3)

    const configCall = expectMoveCall(transactionData.commands[0])
    expect(configCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "config",
      function: "new"
    })

    // Guard the positional encoding of `config::new` arguments.
    const configArgs = configCall.arguments
    expect(configArgs).toHaveLength(9)
    expect(decodePureU64(transactionData.inputs, configArgs, 0)).toBe(
      baseSpreadBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 1)).toBe(
      volatilityMultiplierBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 2)).toBe(
      orderExpirationTimeMs.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 3)).toBe(
      maxPriceAgeSecs.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 4)).toBe(
      maxConfRatioBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 5)).toBe(
      outerBalanceBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 6)).toBe(
      inventorySkewBps.toString()
    )
    expect(decodePureU64(transactionData.inputs, configArgs, 7)).toBe(
      stalePriceToleranceBps.toString()
    )
    expect(decodePureBool(transactionData.inputs, configArgs, 8)).toBe(postOnly)

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

    const cancelCall = expectMoveCall(transactionData.commands[2])
    expect(cancelCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "cancel_orders_after_update"
    })
    expect(cancelCall.typeArguments).toEqual([
      BASE_ASSET_TYPE_TAG,
      QUOTE_ASSET_TYPE_TAG
    ])
    // arg 0: executor shared ref, arg 1: refresh ticket destructured from
    // update_config (NestedResult pointing at command index 1, position 0),
    // arg 2: pool shared ref, arg 3: clock object.
    expect(cancelCall.arguments[1]).toMatchObject({
      $kind: "NestedResult",
      NestedResult: [1, 0]
    })
  })
})
