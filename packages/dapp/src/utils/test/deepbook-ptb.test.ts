import { describe, expect, it } from "vitest"

import { buildCreateTraderAccountTransaction } from "@sui-amm/domain-core/ptb/deepbook"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"

const expectMoveCall = (
  command: ReturnType<
    ReturnType<typeof buildCreateTraderAccountTransaction>["getData"]
  >["commands"][number]
) => {
  expect(command.$kind).toBe("MoveCall")
  if (command.$kind !== "MoveCall") {
    throw new Error("Expected MoveCall command.")
  }

  return command.MoveCall
}

describe("deepbook PTB builders", () => {
  it("builds trader-account creation against the owner entrypoint and includes the admin cap", () => {
    const deepbookRegistry = {
      object: {
        objectId: "0x789",
        version: "7",
        digest: "digest"
      },
      sharedRef: {
        objectId: "0x789",
        initialSharedVersion: "5",
        mutable: false
      }
    } as WrappedSuiSharedObject

    const transaction = buildCreateTraderAccountTransaction({
      ammPackageId: "0x123",
      adminCapId: "0x456",
      deepbookRegistry,
      ownerAddress: "0xabc"
    })

    const transactionData = transaction.getData()
    const moveCall = expectMoveCall(transactionData.commands[0])

    expect(transactionData.commands).toHaveLength(1)
    expect(moveCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "create_trader_account_for_owner"
    })
    expect(moveCall.arguments).toHaveLength(3)
    expect(moveCall.arguments[0]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
    expect(moveCall.arguments[1]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
    expect(moveCall.arguments[2]).toMatchObject({
      $kind: "Input",
      type: "pure"
    })
  })
})
