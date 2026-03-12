import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  AMM_CONFIG_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import { normalizeHex } from "@sui-amm/tooling-core/hex"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import {
  resolveDappMoveRoot,
  resolveDappRoot
} from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"
import { DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID } from "../../../utils/amm.ts"
import {
  resolveKeepTemp,
  resolveOnChainSharedVersion,
  resolveWithFaucet
} from "./test-helpers.ts"

type AmmCreateOutput = {
  adminCapId?: string
  ammConfig?: AmmConfigOverview
  digest?: string
  initialSharedVersion?: string
  pythPriceFeedIdHex?: string
  transactionSummary?: { label?: string }
}

type ObjectArtifact = {
  objectId?: string
  objectType?: string
  initialSharedVersion?: string
}

const resolveOwnerScriptPath = (scriptName: string) =>
  path.join(
    resolveDappRoot(),
    "src",
    "scripts",
    "owner",
    scriptName.endsWith(".ts") ? scriptName : `${scriptName}.ts`
  )

const resolveObjectArtifactsPath = (artifactsDir: string) =>
  path.join(artifactsDir, "objects.localnet.json")

const readObjectArtifacts = async (artifactsDir: string) => {
  const contents = await readFile(
    resolveObjectArtifactsPath(artifactsDir),
    "utf8"
  )

  return JSON.parse(contents) as ObjectArtifact[]
}

const findObjectArtifactById = (
  artifacts: ObjectArtifact[],
  objectId: string
) => artifacts.find((artifact) => artifact.objectId === objectId)

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  keepTemp: resolveKeepTemp(),
  withFaucet: resolveWithFaucet(),
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("owner amm-create integration", () => {
  it("creates a shared AMM config and records artifacts", async () => {
    await testEnv.withTestContext("owner-amm-create", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      await context.publishPackage("prop-amm", publisher, {
        withUnpublishedDependencies: true
      })

      const baseSpreadBps = "37"
      const volatilityMultiplierBps = "420"
      const useLaser = true
      const pythPriceFeedId = DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runScript(
        resolveOwnerScriptPath("amm-create"),
        {
          account: publisher,
          args: {
            json: true,
            baseSpreadBps,
            volatilityMultiplierBps,
            useLaser
          }
        }
      )

      expect(result.exitCode).toBe(0)

      const output = parseJsonFromScriptOutput<AmmCreateOutput>(
        result.stdout,
        "amm-create output"
      )
      if (!output.ammConfig) {
        throw new Error("amm-create output did not include ammConfig.")
      }
      if (!output.initialSharedVersion) {
        throw new Error("amm-create output did not include shared version.")
      }
      if (!output.adminCapId) {
        throw new Error("amm-create output did not include adminCapId.")
      }

      expect(output.digest).toBeTruthy()
      expect(output.transactionSummary?.label).toBe("create-amm")
      expect(output.ammConfig.baseSpreadBps).toBe(baseSpreadBps)
      expect(output.ammConfig.volatilityMultiplierBps).toBe(
        volatilityMultiplierBps
      )
      expect(output.ammConfig.useLaser).toBe(useLaser)
      expect(output.ammConfig.tradingPaused).toBe(false)
      expect(normalizeHex(output.ammConfig.pythPriceFeedIdHex)).toBe(
        normalizeHex(pythPriceFeedId)
      )
      expect(normalizeHex(output.pythPriceFeedIdHex ?? "")).toBe(
        normalizeHex(pythPriceFeedId)
      )

      const onChainSharedVersion = await resolveOnChainSharedVersion(
        context,
        output.ammConfig.configId
      )
      expect(onChainSharedVersion).toBe(output.initialSharedVersion)

      const objectArtifacts = await readObjectArtifacts(context.artifactsDir)
      const createdArtifact = findObjectArtifactById(
        objectArtifacts,
        output.ammConfig.configId
      )
      expect(
        createdArtifact?.objectType?.endsWith(AMM_CONFIG_TYPE_SUFFIX)
      ).toBe(true)
      expect(createdArtifact?.initialSharedVersion).toBe(
        output.initialSharedVersion
      )
    })
  })
})
