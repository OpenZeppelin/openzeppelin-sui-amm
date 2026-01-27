import { describe, it } from "vitest"

import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { newTransaction } from "@sui-amm/tooling-core/transactions"
import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/artifacts"

import {
  assertEventByDigest,
  assertObjectOwnerById,
  requireCreatedObjectId
} from "@sui-amm/tooling-node/testing/assert"

import { createToolingIntegrationTestEnv } from "../helpers/env.ts"

const testEnv = createToolingIntegrationTestEnv()

const eventTypeEndsWith = (eventType: string, suffix: string) =>
  eventType.toLowerCase().endsWith(suffix.toLowerCase())

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

describe("transactions and events", () => {
  it("creates a counter and updates the owner with event assertions", async () => {
    await testEnv.withTestContext(
      "transactions-create-counter",
      async (context) => {
        const publisher = context.createAccount("publisher")
        await context.fundAccount(publisher, { minimumCoinObjects: 2 })

        const artifacts = await context.publishPackage(
          "simple-contract",
          publisher,
          { withUnpublishedDependencies: true }
        )
        const rootArtifact = pickRootNonDependencyArtifact(artifacts)

        const createCounterTransaction = buildCreateCounterTransaction(
          rootArtifact.packageId,
          "Integration Counter"
        )
        const createResult = await context.signAndExecuteTransaction(
          createCounterTransaction,
          publisher
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

        await assertObjectOwnerById({
          suiClient: context.suiClient,
          objectId: ownerCapId,
          expectedOwner: publisher.address,
          label: "CounterOwnerCap"
        })

        await assertEventByDigest({
          suiClient: context.suiClient,
          digest: createResult.digest,
          predicate: (event) =>
            eventTypeEndsWith(event.type, "::counter::CounterCreated"),
          label: "CounterCreated"
        })

        const newOwner = context.createAccount("new-owner")
        const counterShared = await getSuiSharedObject(
          { objectId: counterId, mutable: true },
          { suiClient: context.suiClient }
        )

        const updateOwnerTransaction = buildUpdateCounterOwnerTransaction(
          rootArtifact.packageId,
          counterShared,
          ownerCapId,
          newOwner.address
        )
        const updateResult = await context.signAndExecuteTransaction(
          updateOwnerTransaction,
          publisher
        )
        await context.waitForFinality(updateResult.digest)

        await assertEventByDigest({
          suiClient: context.suiClient,
          digest: updateResult.digest,
          predicate: (event) =>
            eventTypeEndsWith(event.type, "::counter::CounterOwnerUpdated"),
          label: "CounterOwnerUpdated"
        })
      }
    )
  })
})
