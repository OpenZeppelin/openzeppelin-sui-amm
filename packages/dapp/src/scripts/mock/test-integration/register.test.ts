import { describe, expect, it } from "vitest"

import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { isBalanceManagerMapInitialized } from "@sui-amm/domain-core/models/deepbook"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/artifacts"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput,
  resolveScriptPathIn
} from "@sui-amm/tooling-node/testing/scripts"

type RegisterOutput = {
  ammPackageId?: string
  ammAdminCapId?: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
  deepbookAdminCapId?: string
  traderAccountId?: string
  balanceManagerId?: string
  ownerAddress?: string
}

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("mock register integration", () => {
  it("authorizes PropAmm and registers the balance manager", async () => {
    await testEnv.withTestContext("mock-register", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const publishArtifacts = await context.publishPackage(
        "prop-amm",
        publisher,
        { withUnpublishedDependencies: true }
      )
      const rootArtifact = pickRootNonDependencyArtifact(publishArtifacts)

      await context.waitForFinality(rootArtifact.digest)
      const deepbookPublish = await context.suiClient.getTransactionBlock({
        digest: rootArtifact.digest,
        options: { showObjectChanges: true }
      })

      const deepbookRegistry = ensureCreatedObject(
        "::registry::Registry",
        deepbookPublish
      )
      const deepbookAdminCap = ensureCreatedObject(
        "::registry::DeepbookAdminCap",
        deepbookPublish
      )

      const deepbookPackageId = normalizeSuiObjectId(
        deepbookRegistry.objectType.split("::")[0] ?? ""
      )
      const deepbookRegistryId = deepbookRegistry.objectId
      const deepbookAdminCapId = deepbookAdminCap.objectId

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runScript(
        resolveScriptPathIn("mock", "register"),
        {
          account: publisher,
          args: {
            json: true,
            ammPackageId: rootArtifact.packageId,
            deepbookPackageId,
            deepbookRegistryId,
            deepbookAdminCapId,
            ownerAddress: publisher.address
          }
        }
      )

      expect(result.exitCode).toBe(0)

      const output = parseJsonFromScriptOutput<RegisterOutput>(
        result.stdout,
        "mock register output"
      )

      expect(output.ammPackageId).toBe(rootArtifact.packageId)
      expect(output.deepbookPackageId).toBe(deepbookPackageId)
      expect(output.deepbookRegistryId).toBe(deepbookRegistryId)
      expect(output.deepbookAdminCapId).toBe(deepbookAdminCapId)
      expect(output.ownerAddress).toBe(publisher.address)
      expect(output.ammAdminCapId).toBeTruthy()
      expect(output.traderAccountId).toBeTruthy()
      expect(output.balanceManagerId).toBeTruthy()

      const balanceManagerMapInitialized = await isBalanceManagerMapInitialized(
        {
          suiClient: context.suiClient,
          deepbookRegistryId,
          deepbookPackageId
        }
      )

      expect(balanceManagerMapInitialized).toBe(true)
    })
  })
})
