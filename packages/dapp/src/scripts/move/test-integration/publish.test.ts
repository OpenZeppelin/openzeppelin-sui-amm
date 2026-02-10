import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { createSuiScriptRunner } from "@sui-amm/tooling-node/testing/scripts"
import {
  resolveDappMoveRoot,
  resolveDappRoot,
  resolveWorkspaceRoot
} from "@sui-amm/tooling-node/testing/paths"
import { resolveDeepbookContractPathSync } from "../../../utils/mocks.ts"

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  moveSourceRootPath: resolveDappMoveRoot()
})

const resolveMoveScriptPath = (scriptName: string) =>
  path.join(resolveDappRoot(), "src", "scripts", "move", `${scriptName}.ts`)

const readDeploymentArtifacts = async (
  artifactsDir: string
): Promise<PublishArtifact[]> => {
  const artifactPath = path.join(artifactsDir, "deployment.localnet.json")
  const contents = await readFile(artifactPath, "utf8")
  return JSON.parse(contents) as PublishArtifact[]
}

const hasArtifactForPackagePath = (
  artifacts: PublishArtifact[],
  packagePath: string
) =>
  artifacts.some(
    (artifact) =>
      path.resolve(artifact.packagePath) === path.resolve(packagePath)
  )

describe("move publish integration", () => {
  it("publishes a package and records deployment artifacts", async () => {
    await testEnv.withTestContext("move-publish", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runScript(
        resolveMoveScriptPath("publish"),
        {
          account: publisher,
          args: {
            packagePath: "coin-mock",
            rePublish: true,
            withUnpublishedDependencies: false
          }
        }
      )

      expect(result.exitCode).toBe(0)

      const artifacts = await readDeploymentArtifacts(context.artifactsDir)
      const packagePath = path.join(context.moveRootPath, "coin-mock")
      expect(hasArtifactForPackagePath(artifacts, packagePath)).toBe(true)
    })
  })

  const deepbookContractPath = resolveDeepbookContractPathSync({
    basePath: resolveWorkspaceRoot(),
    allowMissing: true
  })
  const runGuardTest = deepbookContractPath ? it : it.skip

  runGuardTest(
    "rejects PropAmm publish without localnet dep replacements",
    async () => {
      await testEnv.withTestContext("move-publish-guard", async (context) => {
        const publisher = context.createAccount("publisher")
        await context.fundAccount(publisher, { minimumCoinObjects: 2 })

        const tempPackagePath = path.join(context.tempDir, "prop-amm-temp")
        await mkdir(tempPackagePath, { recursive: true })
        await writeFile(
          path.join(tempPackagePath, "Move.toml"),
          [
            "[package]",
            'name = "PropAmm"',
            'edition = "2024"',
            'version = "0.0.1"'
          ].join("\n")
        )

        const scriptRunner = createSuiScriptRunner(context)
        const result = await scriptRunner.runScript(
          resolveMoveScriptPath("publish"),
          {
            account: publisher,
            allowFailure: true,
            args: {
              packagePath: tempPackagePath,
              withUnpublishedDependencies: false
            }
          }
        )

        expect(result.exitCode).not.toBe(0)
        const output = `${result.stdout}\n${result.stderr}`
        expect(output).toContain("dep-replacements.localnet")
      })
    }
  )
})
