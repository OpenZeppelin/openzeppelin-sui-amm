import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  AMM_CONFIG_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import { DEFAULT_MOCK_PRICE_FEED } from "@sui-amm/domain-core/models/pyth"
import {
  buildCreateAmmConfigTransaction,
  parsePythPriceFeedIdBytes
} from "@sui-amm/domain-core/ptb/amm"
import { normalizeHex } from "@sui-amm/tooling-core/hex"
import { extractInitialSharedVersion } from "@sui-amm/tooling-core/shared-object"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/artifacts"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import {
  resolveDappMoveRoot,
  resolveDappRoot
} from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"

type AmmViewOutput = {
  ammConfig?: AmmConfigOverview
  initialSharedVersion?: string
}

const resolveKeepTemp = () => process.env.SUI_IT_KEEP_TEMP === "1"

const resolveWithFaucet = () => process.env.SUI_IT_WITH_FAUCET !== "0"

const resolveUserScriptPath = (scriptName: string) =>
  path.join(
    resolveDappRoot(),
    "src",
    "scripts",
    "user",
    scriptName.endsWith(".ts") ? scriptName : `${scriptName}.ts`
  )

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  keepTemp: resolveKeepTemp(),
  withFaucet: resolveWithFaucet(),
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("amm-view script", () => {
  it("renders the latest AMM config snapshot when no id is provided", async () => {
    await testEnv.withTestContext("user-amm-view", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const publishArtifacts = await context.publishPackage(
        "prop-amm",
        publisher,
        { withUnpublishedDependencies: true }
      )
      const rootArtifact = pickRootNonDependencyArtifact(publishArtifacts)

      const baseSpreadBps = 37n
      const volatilityMultiplierBps = 420n
      const useLaser = true
      const pythPriceFeedIdHex = DEFAULT_MOCK_PRICE_FEED.feedIdHex
      const createTransaction = buildCreateAmmConfigTransaction({
        packageId: rootArtifact.packageId,
        baseSpreadBps,
        volatilityMultiplierBps,
        useLaser,
        pythPriceFeedIdBytes: parsePythPriceFeedIdBytes(pythPriceFeedIdHex)
      })

      const createResult = await context.signAndExecuteTransaction(
        createTransaction,
        publisher
      )
      await context.waitForFinality(createResult.digest)

      const createdConfig = ensureCreatedObject(
        AMM_CONFIG_TYPE_SUFFIX,
        createResult
      )
      const ammConfigId = createdConfig.objectId
      const initialSharedVersion = extractInitialSharedVersion(createdConfig)
      if (!initialSharedVersion)
        throw new Error(
          "Expected AMM config to include shared version metadata."
        )

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runScript(
        resolveUserScriptPath("amm-view"),
        {
          account: publisher,
          args: { json: true }
        }
      )

      expect(result.exitCode).toBe(0)

      const parsed = parseJsonFromScriptOutput<AmmViewOutput>(
        result.stdout,
        "amm-view output"
      )
      if (!parsed.ammConfig)
        throw new Error("amm-view output did not include ammConfig.")
      if (!parsed.initialSharedVersion)
        throw new Error("amm-view output did not include shared version.")

      expect(parsed.ammConfig.configId).toBe(ammConfigId)
      expect(parsed.ammConfig.baseSpreadBps).toBe(baseSpreadBps.toString())
      expect(parsed.ammConfig.volatilityMultiplierBps).toBe(
        volatilityMultiplierBps.toString()
      )
      expect(parsed.ammConfig.useLaser).toBe(useLaser)
      expect(parsed.ammConfig.tradingPaused).toBe(false)
      expect(normalizeHex(parsed.ammConfig.pythPriceFeedIdHex)).toBe(
        normalizeHex(pythPriceFeedIdHex)
      )
      expect(parsed.initialSharedVersion).toBe(initialSharedVersion)
    })
  })
})
