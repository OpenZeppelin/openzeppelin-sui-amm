import { describe, expect, it } from "vitest"

import {
  buildCreateAmmConfigTransaction,
  buildUpdateAmmConfigTransaction
} from "@sui-amm/domain-core/ptb/amm"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"

const expectMoveCall = (
  command: ReturnType<
    ReturnType<typeof buildCreateAmmConfigTransaction>["getData"]
  >["commands"][number]
) => {
  expect(command.$kind).toBe("MoveCall")
  if (command.$kind !== "MoveCall") {
    throw new Error("Expected MoveCall command.")
  }

  return command.MoveCall
}

describe("amm PTB builders", () => {
  it("builds create against the current manager entrypoint and includes the admin cap", () => {
    const transaction = buildCreateAmmConfigTransaction({
      packageId: "0x123",
      adminCapId: "0x456",
      baseSpreadBps: 25n,
      volatilitySpreadBps: 200n,
      useLaser: true,
      pythPriceFeedIdBytes: Array.from({ length: 32 }, (_, index) => index)
    })

    const transactionData = transaction.getData()
    const moveCall = expectMoveCall(transactionData.commands[0])

    expect(transactionData.commands).toHaveLength(1)
    expect(moveCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "manager",
      function: "create_amm_config_and_share"
    })
    expect(moveCall.arguments[0]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
  })

  it("rejects create when the feed id bytes are not passed as a 32-byte array", () => {
    expect(() =>
      buildCreateAmmConfigTransaction({
        packageId: "0x123",
        adminCapId: "0x456",
        baseSpreadBps: 25n,
        volatilitySpreadBps: 200n,
        useLaser: true,
        pythPriceFeedIdBytes: "0xfeed" as unknown as number[]
      })
    ).toThrowError(
      new TypeError("pythPriceFeedIdBytes must be a 32-byte array.")
    )
  })

  it("builds update against the current emit entrypoint and keeps the shared config ref", () => {
    const config = {
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

    const transaction = buildUpdateAmmConfigTransaction({
      packageId: "0x123",
      adminCapId: "0x456",
      config,
      baseSpreadBps: 25n,
      volatilitySpreadBps: 200n,
      useLaser: false,
      tradingPaused: true,
      pythPriceFeedIdBytes: Array.from({ length: 32 }, (_, index) => index)
    })

    const transactionData = transaction.getData()
    const moveCall = expectMoveCall(transactionData.commands[0])

    expect(transactionData.commands).toHaveLength(1)
    expect(moveCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "manager",
      function: "update_amm_config"
    })
    expect(moveCall.arguments[0]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
    expect(moveCall.arguments[1]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
  })

  it("rejects update when the feed id bytes are not 32 bytes long", () => {
    const config = {
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
      buildUpdateAmmConfigTransaction({
        packageId: "0x123",
        adminCapId: "0x456",
        config,
        baseSpreadBps: 25n,
        volatilitySpreadBps: 200n,
        useLaser: false,
        tradingPaused: true,
        pythPriceFeedIdBytes: Array.from({ length: 31 }, (_, index) => index)
      })
    ).toThrowError(
      new TypeError("pythPriceFeedIdBytes must be a 32-byte array.")
    )
  })
})
