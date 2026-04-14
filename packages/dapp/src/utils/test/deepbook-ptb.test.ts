import { describe, expect, it } from "vitest"

import { buildCreateTraderAccountTransaction } from "@sui-amm/domain-core/ptb/deepbook"

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
  it("builds market maker creation against the market_maker module", () => {
    const transaction = buildCreateTraderAccountTransaction({
      ammPackageId: "0x123",
      adminCapId: "0x456"
    })

    const transactionData = transaction.getData()
    const moveCall = expectMoveCall(transactionData.commands[0])

    expect(transactionData.commands).toHaveLength(1)
    expect(moveCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "market_maker",
      function: "create"
    })
    expect(moveCall.arguments).toHaveLength(1)
    expect(moveCall.arguments[0]).toMatchObject({
      $kind: "Input",
      type: "object"
    })
  })
})
