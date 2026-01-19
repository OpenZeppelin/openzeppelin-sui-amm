import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/artifacts"

import { createToolingIntegrationTestEnv } from "../helpers/env.ts"

const testEnv = createToolingIntegrationTestEnv()

describe("move build and publish", () => {
  it("builds the amm Move package", async () => {
    await testEnv.withTestContext("move-build-amm", async (context) => {
      const buildOutput = await context.buildMovePackage("amm")

      expect(buildOutput.modules.length).toBeGreaterThan(0)
      expect(Array.isArray(buildOutput.dependencies)).toBe(true)
    })
  })

  it("publishes the amm Move package and writes artifacts", async () => {
    await testEnv.withTestContext("move-publish-amm", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const artifacts = await context.publishPackage("amm", publisher, {
        withUnpublishedDependencies: true
      })

      const rootArtifact = pickRootNonDependencyArtifact(artifacts)
      expect(rootArtifact.packageId).toMatch(/^0x[0-9a-fA-F]+$/)

      const deploymentPath = path.join(
        context.artifactsDir,
        "deployment.localnet.json"
      )
      const deploymentContents = await readFile(deploymentPath, "utf8")

      expect(deploymentContents).toContain(rootArtifact.packageId)
    })
  })
})
