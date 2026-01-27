import { describe, expect, it } from "vitest"

import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import {
  newTransaction,
  resolveSplitCoinResult
} from "@sui-amm/tooling-core/transactions"
import {
  pickRootNonDependencyArtifact,
  withArtifactsRoot
} from "@sui-amm/tooling-node/artifacts"
import { signAndExecute } from "@sui-amm/tooling-node/transactions"

import { requireCreatedObjectId } from "@sui-amm/tooling-node/testing/assert"

import type {
  TestAccount,
  TestContext
} from "@sui-amm/tooling-node/testing/localnet"
import { createToolingIntegrationTestEnv } from "../helpers/env.ts"

const testEnv = createToolingIntegrationTestEnv()

const unwrapSplitCoin = (value: Parameters<typeof resolveSplitCoinResult>[0]) =>
  resolveSplitCoinResult(value, 0)

const publishSimpleContract = async (
  context: TestContext,
  publisherLabel: string
) => {
  const publisher = context.createAccount(publisherLabel)
  await context.fundAccount(publisher, { minimumCoinObjects: 2 })

  const artifacts = await context.publishPackage("simple-contract", publisher, {
    withUnpublishedDependencies: true
  })
  const rootArtifact = pickRootNonDependencyArtifact(artifacts)

  return { publisher, packageId: rootArtifact.packageId }
}

const encodeCounterLabel = (label: string) => {
  if (!label.trim()) throw new Error("Counter label cannot be empty.")
  return new TextEncoder().encode(label)
}

const buildCreateCounterTransaction = (
  packageId: string,
  counterLabel: string
) => {
  const transaction = newTransaction()
  transaction.moveCall({
    target: `${packageId}::counter::create_counter`,
    arguments: [transaction.pure.vector("u8", encodeCounterLabel(counterLabel))]
  })
  return transaction
}

const buildUpdateCounterOwnerTransaction = (
  packageId: string,
  counter: WrappedSuiSharedObject,
  ownerCapId: string,
  newOwner: string
) => {
  const transaction = newTransaction()
  const counterArgument = transaction.sharedObjectRef(counter.sharedRef)
  transaction.moveCall({
    target: `${packageId}::counter::update_counter_owner`,
    arguments: [
      counterArgument,
      transaction.object(ownerCapId),
      transaction.pure.address(newOwner)
    ]
  })
  return transaction
}

const createCounter = async (
  context: TestContext,
  packageId: string,
  owner: TestAccount,
  counterLabel: string
) => {
  const createCounterTransaction = buildCreateCounterTransaction(
    packageId,
    counterLabel
  )
  const createResult = await context.signAndExecuteTransaction(
    createCounterTransaction,
    owner
  )
  await context.waitForFinality(createResult.digest)

  const counterId = requireCreatedObjectId(
    createResult,
    "::counter::Counter",
    "Counter"
  )
  const ownerCapId = requireCreatedObjectId(
    createResult,
    "::counter::CounterOwnerCap",
    "CounterOwnerCap"
  )

  const counterShared = await getSuiSharedObject(
    { objectId: counterId, mutable: true },
    { suiClient: context.suiClient }
  )

  return { counterId, ownerCapId, counterShared }
}

describe("security and concurrency", () => {
  it("rejects owner-cap misuse between counters", async () => {
    await testEnv.withTestContext("security-owner-cap", async (context) => {
      const { publisher, packageId } = await publishSimpleContract(
        context,
        "publisher-a"
      )
      const secondOwner = context.createAccount("publisher-b")
      await context.fundAccount(secondOwner, { minimumCoinObjects: 2 })

      const counterA = await createCounter(
        context,
        packageId,
        publisher,
        "Counter A"
      )
      const counterB = await createCounter(
        context,
        packageId,
        secondOwner,
        "Counter B"
      )

      const updateOwnerTransaction = buildUpdateCounterOwnerTransaction(
        packageId,
        counterA.counterShared,
        counterB.ownerCapId,
        secondOwner.address
      )

      await expect(
        context.signAndExecuteTransaction(updateOwnerTransaction, secondOwner)
      ).rejects.toThrow()
    })
  })

  it("rejects transactions signed by a different sender", async () => {
    await testEnv.withTestContext(
      "security-signer-mismatch",
      async (context) => {
        const sender = context.createAccount("sender")
        const signer = context.createAccount("signer")
        await context.fundAccount(sender, { minimumCoinObjects: 2 })
        await context.fundAccount(signer, { minimumCoinObjects: 2 })

        const transaction = newTransaction()
        const splitCoin = transaction.splitCoins(transaction.gas, [
          transaction.pure.u64(1_000_000n)
        ])
        transaction.transferObjects(
          [unwrapSplitCoin(splitCoin)],
          transaction.pure.address(sender.address)
        )
        transaction.setSender(sender.address)

        await expect(
          withArtifactsRoot(context.artifactsDir, () =>
            signAndExecute(
              { transaction, signer: signer.keypair },
              { suiClient: context.suiClient, suiConfig: context.suiConfig }
            )
          )
        ).rejects.toThrow()
      }
    )
  })

  it("retries when two transactions contend on the same gas coin", async () => {
    await testEnv.withTestContext("concurrency-gas", async (context) => {
      const account = context.createAccount("gas-owner")
      await context.fundAccount(account, { minimumCoinObjects: 2 })

      const coins = await context.suiClient.getCoins({
        owner: account.address,
        coinType: "0x2::sui::SUI",
        limit: 1
      })
      const gasCoin = coins.data[0]
      if (!gasCoin) {
        throw new Error("Missing gas coin after funding")
      }

      const buildContendedTransfer = (recipientAddress: string) => {
        const transaction = newTransaction()
        const splitCoin = transaction.splitCoins(transaction.gas, [
          transaction.pure.u64(1_000_000n)
        ])
        transaction.transferObjects(
          [unwrapSplitCoin(splitCoin)],
          transaction.pure.address(recipientAddress)
        )
        transaction.setGasPayment([
          {
            objectId: gasCoin.coinObjectId,
            version: gasCoin.version,
            digest: gasCoin.digest
          }
        ])
        transaction.setGasOwner(account.address)
        return transaction
      }

      const txA = buildContendedTransfer(context.createAccount("a").address)
      const txB = buildContendedTransfer(context.createAccount("b").address)

      const results = await Promise.allSettled([
        context.signAndExecuteTransaction(txA, account),
        context.signAndExecuteTransaction(txB, account)
      ])

      const successCount = results.filter(
        (result) => result.status === "fulfilled"
      ).length
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason as Error)

      expect(successCount).toBeGreaterThan(0)
      if (errors.length > 0) {
        const errorMessages = errors.map((error) => error.message).join("\n")
        expect(errorMessages).toMatch(/object|lock|gas|stale/i)
      }
    })
  })

  it("fails when the signer has no gas", async () => {
    await testEnv.withTestContext("security-no-gas", async (context) => {
      const account = context.createAccount("unfunded")

      const transaction = newTransaction()
      const splitCoin = transaction.splitCoins(transaction.gas, [
        transaction.pure.u64(1_000_000n)
      ])
      transaction.transferObjects(
        [unwrapSplitCoin(splitCoin)],
        transaction.pure.address(context.createAccount("recipient").address)
      )

      await expect(
        context.signAndExecuteTransaction(transaction, account)
      ).rejects.toThrow(/gas|coin/i)
    })
  })
})
