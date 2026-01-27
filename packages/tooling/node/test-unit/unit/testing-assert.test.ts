import { describe, expect, it, vi } from "vitest"

import {
  assertBalanceChange,
  assertEventByDigest,
  assertMoveAbort,
  assertObjectOwnerById,
  assertOwnerAddress,
  assertTransactionFailed,
  assertTransactionSucceeded,
  requireCreatedObjectId
} from "../../src/testing/assert.ts"

describe("testing assert helpers", () => {
  it("asserts transaction success", () => {
    expect(() =>
      assertTransactionSucceeded({
        effects: { status: { status: "success" } }
      } as never)
    ).not.toThrow()
  })

  it("asserts transaction failure", () => {
    const error = assertTransactionFailed({
      effects: { status: { status: "failure", error: "bad" } }
    } as never)

    expect(error).toBe("bad")
  })

  it("asserts object ownership by id", async () => {
    const getObject = vi.fn().mockResolvedValue({
      data: { owner: { AddressOwner: "0x1" } }
    })

    await expect(
      assertObjectOwnerById({
        suiClient: { getObject } as never,
        objectId: "0x2",
        expectedOwner: "0x1"
      })
    ).resolves.toBeDefined()
  })

  it("asserts event by digest", async () => {
    const queryEvents = vi.fn().mockResolvedValue({
      data: [{ type: "0x1::counter::Event", id: { txDigest: "0xabc" } }]
    })

    const event = await assertEventByDigest({
      suiClient: { queryEvents } as never,
      digest: "0xabc",
      eventType: "0x1::counter::Event"
    })

    expect(event.type).toBe("0x1::counter::Event")
  })

  it("asserts move abort details", () => {
    const error =
      'MoveAbort(MoveLocation { module: "counter", function: 1, instruction: 0, function_name: "create_counter" }, 42)'

    const details = assertMoveAbort(
      {
        effects: { status: { status: "failure", error } }
      } as never,
      { module: "counter", functionName: "create_counter", abortCode: 42 }
    )

    expect(details.abortCode).toBe(42)
    expect(details.functionName).toBe("create_counter")
  })

  it("asserts move abort details with address-qualified modules", () => {
    const error =
      "MoveAbort(AbortLocation { module: 0x2::counter, function: create_counter }, abort_code: 7)"

    const details = assertMoveAbort(
      {
        effects: { status: { status: "failure", error } }
      } as never,
      { module: "counter", functionName: "create_counter", abortCode: 7 }
    )

    expect(details.abortCode).toBe(7)
    expect(details.module).toBe("counter")
  })

  it("requires created object ids", () => {
    const createdId = requireCreatedObjectId(
      {
        objectChanges: [
          {
            type: "created",
            objectId: "0x1",
            objectType: "0x2::counter::Counter"
          }
        ]
      } as never,
      "::counter::Counter"
    )

    expect(createdId).toBe("0x1")
  })

  it("asserts owner address matches", () => {
    expect(() =>
      assertOwnerAddress({ AddressOwner: "0x1" }, "0x1")
    ).not.toThrow()
  })

  it("asserts balance changes", () => {
    expect(() =>
      assertBalanceChange(
        {
          balanceChanges: [
            {
              owner: "0x1",
              coinType: "0x2::sui::SUI",
              amount: "-100"
            }
          ]
        } as never,
        { owner: "0x1", delta: -100n }
      )
    ).not.toThrow()
  })
})
