import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/artifacts"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"

import { createToolingIntegrationTestEnv } from "../helpers/env.ts"

const testEnv = createToolingIntegrationTestEnv()

describe("script runner", () => {
  it("runs owner counter-create script on localnet", async () => {
    await testEnv.withTestContext("owner-counter-create", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const artifacts = await context.publishPackage(
        "simple-contract",
        publisher,
        { withUnpublishedDependencies: true }
      )
      const rootArtifact = pickRootNonDependencyArtifact(artifacts)

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runOwnerScript("counter-create", {
        account: publisher,
        args: {
          json: true,
          counterPackageId: rootArtifact.packageId,
          label: "Script Counter"
        }
      })

      expect(result.exitCode).toBe(0)
      const parsed = parseJsonFromScriptOutput<{
        counterOverview?: { counterId?: string }
      }>(result.stdout, "counter-create output")
      expect(parsed.counterOverview?.counterId).toBeTruthy()

      const objectsPath = path.join(
        context.artifactsDir,
        "objects.localnet.json"
      )
      const objectsContents = await readFile(objectsPath, "utf8")
      const objects = JSON.parse(objectsContents) as Array<{
        objectType?: string
      }>

      const hasCounterObject = objects.some((entry) =>
        entry.objectType?.endsWith("::counter::Counter")
      )
      expect(hasCounterObject).toBe(true)
    })
  })
})
