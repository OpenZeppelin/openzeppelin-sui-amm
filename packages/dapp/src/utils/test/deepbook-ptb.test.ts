import { Transaction } from "@mysten/sui/transactions"
import { describe, expect, it } from "vitest"

import {
  depositTraderAccount,
  withdrawTraderAccount
} from "@sui-amm/domain-core/ptb/deepbook"

const expectMoveCall = (
  command: ReturnType<Transaction["getData"]>["commands"][number]
) => {
  expect(command.$kind).toBe("MoveCall")
  if (command.$kind !== "MoveCall") {
    throw new Error("Expected MoveCall command.")
  }

  return command.MoveCall
}

describe("deepbook PTB builders", () => {
  it("builds deposit against the executor module", () => {
    const transaction = new Transaction()
    const fundingCoin = transaction.object("0xc01")

    depositTraderAccount({
      transaction,
      ammPackageId: "0x123",
      traderAccountId: "0xa11",
      ammAdminCapId: "0xa22",
      fundingCoin,
      coinAssetType:
        "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
    })

    const transactionData = transaction.getData()
    expect(transactionData.commands).toHaveLength(1)
    const [command] = transactionData.commands
    const moveCall = expectMoveCall(command)
    expect(moveCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "deposit",
      typeArguments: [
        "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
      ]
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
      type: "object"
    })
  })

  it("builds withdraw against the executor module", () => {
    const transaction = new Transaction()

    withdrawTraderAccount({
      transaction,
      ammPackageId: "0x123",
      traderAccountId: "0xa11",
      ammAdminCapId: "0xa22",
      withdrawAmount: 125n,
      coinAssetType:
        "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
    })

    const transactionData = transaction.getData()
    const moveCall = expectMoveCall(transactionData.commands[0])

    expect(transactionData.commands).toHaveLength(1)
    expect(moveCall).toMatchObject({
      package:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      module: "executor",
      function: "withdraw",
      typeArguments: [
        "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
      ]
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
