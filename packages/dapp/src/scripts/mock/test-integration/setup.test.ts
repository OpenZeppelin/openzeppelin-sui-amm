import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import {
  resolveDappMoveRoot,
  resolveWorkspaceRoot
} from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  resolveScriptPathIn
} from "@sui-amm/tooling-node/testing/scripts"
import { resolveDeepbookContractPathSync } from "../../../utils/mocks.ts"

type MockArtifact = {
  deepbookPackageId?: string
  deepbookTokenPackageId?: string
  deepbookRegistryId?: string
  deepbookAdminCapId?: string
}

const resolveMockArtifactPath = (artifactsDir: string) =>
  path.join(artifactsDir, "mock.localnet.json")

const readMockArtifact = async (artifactsDir: string) => {
  const contents = await readFile(resolveMockArtifactPath(artifactsDir), "utf8")
  return JSON.parse(contents) as MockArtifact
}

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("mock setup integration", () => {
  const deepbookContractPath = resolveDeepbookContractPathSync({
    basePath: resolveWorkspaceRoot(),
    allowMissing: true
  })
  const runTest = deepbookContractPath ? it : it.skip

  runTest("publishes DeepBook and records registry artifacts", async () => {
    if (!deepbookContractPath)
      throw new Error("DeepBook contract path was not resolved for localnet.")
    await testEnv.withTestContext("mock-setup", async (context) => {
      const externalMoveRoot = path.join(context.moveRootPath, "__external__")
      const tempDeepbookContractPath = resolveDeepbookContractPathSync({
        basePath: externalMoveRoot,
        allowMissing: true
      })
      if (!tempDeepbookContractPath)
        throw new Error(
          `DeepBook contract path was not resolved under ${externalMoveRoot}.`
        )
      const tempTokenContractPath = path.resolve(
        tempDeepbookContractPath,
        "..",
        "token"
      )

      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runScript(
        resolveScriptPathIn("mock", "setup"),
        {
          account: publisher,
          args: {
            deepbookContractPath: tempDeepbookContractPath,
            deepbookTokenContractPath: tempTokenContractPath,
            rePublish: true
          }
        }
      )

      expect(result.exitCode).toBe(0)

      const mockArtifact = await readMockArtifact(context.artifactsDir)
      expect(mockArtifact.deepbookPackageId).toBeTruthy()
      expect(mockArtifact.deepbookTokenPackageId).toBeTruthy()
      expect(mockArtifact.deepbookRegistryId).toBeTruthy()
      expect(mockArtifact.deepbookAdminCapId).toBeTruthy()
    })
  })
})
