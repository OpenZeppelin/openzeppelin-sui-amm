import { Transaction } from "@mysten/sui/transactions"
import { describe, expect, it } from "vitest"

import {
  fundTraderAccount,
  withdrawTraderAccount
} from "@sui-amm/domain-core/ptb/deepbook"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"

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
  it("builds fund_trader_account against the executor module", () => {
    const transaction = new Transaction()
    const balanceManager = {
      object: {
        objectId: "0xb0",
        version: "7",
        digest: "digest"
      },
      sharedRef: {
        objectId: "0xb0",
        initialSharedVersion: "5",
        mutable: true
      }
    } as WrappedSuiSharedObject
    const fundingCoin = transaction.object("0xc01")

    fundTraderAccount({
      transaction,
      ammPackageId: "0x123",
      traderAccountId: "0xa11",
      balanceManager,
      fundingCoin,
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
      function: "fund_trader_account",
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

  it("builds withdraw_trader_account against the executor module", () => {
    const transaction = new Transaction()
    const balanceManager = {
      object: {
        objectId: "0xb0",
        version: "7",
        digest: "digest"
      },
      sharedRef: {
        objectId: "0xb0",
        initialSharedVersion: "5",
        mutable: true
      }
    } as WrappedSuiSharedObject

    withdrawTraderAccount({
      transaction,
      ammPackageId: "0x123",
      traderAccountId: "0xa11",
      balanceManager,
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
      function: "withdraw_trader_account",
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
