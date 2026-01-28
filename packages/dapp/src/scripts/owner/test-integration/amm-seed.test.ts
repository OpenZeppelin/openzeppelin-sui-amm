import { describe, expect, it } from "vitest"

import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import { DEFAULT_MOCK_PRICE_FEED } from "@sui-amm/domain-core/models/pyth"
import { normalizeHex } from "@sui-amm/tooling-core/hex"
import { extractInitialSharedVersion } from "@sui-amm/tooling-core/shared-object"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput,
  resolveOwnerScriptPath
} from "@sui-amm/tooling-node/testing/scripts"

type AmmSeedOutput = {
  ammPackageId?: string
  ammConfig?: AmmConfigOverview
  ammConfigId?: string
  initialSharedVersion?: string
  pythPriceFeedIdHex?: string
  publishDigest?: string
  transactionSummary?: { label?: string }
  didPublish?: boolean
  didCreateAmmConfig?: boolean
}

const resolveKeepTemp = () => process.env.SUI_IT_KEEP_TEMP === "1"

const resolveWithFaucet = () => process.env.SUI_IT_WITH_FAUCET !== "0"

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  keepTemp: resolveKeepTemp(),
  withFaucet: resolveWithFaucet(),
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("owner amm-seed integration", () => {
  it("publishes the AMM package and creates the AMM config when missing", async () => {
    await testEnv.withTestContext("owner-amm-seed", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runScript(
        resolveOwnerScriptPath("amm-seed"),
        {
          account: publisher,
          args: {
            json: true,
            baseSpreadBps: "37",
            volatilityMultiplierBps: "420",
            useLaser: true,
            pythPriceFeedId: DEFAULT_MOCK_PRICE_FEED.feedIdHex
          }
        }
      )

      expect(result.exitCode).toBe(0)

      const output = parseJsonFromScriptOutput<AmmSeedOutput>(
        result.stdout,
        "amm-seed output"
      )

      if (!output.ammPackageId)
        throw new Error("amm-seed output did not include ammPackageId.")
      if (!output.ammConfig)
        throw new Error("amm-seed output did not include ammConfig.")
      if (!output.ammConfigId)
        throw new Error("amm-seed output did not include ammConfigId.")
      if (!output.initialSharedVersion)
        throw new Error(
          "amm-seed output did not include the shared version for the config."
        )

      expect(output.didPublish).toBe(true)
      expect(output.didCreateAmmConfig).toBe(true)
      expect(output.transactionSummary?.label).toBe("create-amm")
      expect(output.ammConfigId).toBe(output.ammConfig.configId)
      expect(output.ammConfig.baseSpreadBps).toBe("37")
      expect(output.ammConfig.volatilityMultiplierBps).toBe("420")
      expect(output.ammConfig.useLaser).toBe(true)
      expect(output.ammConfig.tradingPaused).toBe(false)
      expect(normalizeHex(output.ammConfig.pythPriceFeedIdHex)).toBe(
        normalizeHex(DEFAULT_MOCK_PRICE_FEED.feedIdHex)
      )
      expect(normalizeHex(output.pythPriceFeedIdHex ?? "")).toBe(
        normalizeHex(DEFAULT_MOCK_PRICE_FEED.feedIdHex)
      )

      const objectResponse = await context.suiClient.getObject({
        id: output.ammConfig.configId,
        options: { showOwner: true }
      })
      if (!objectResponse.data)
        throw new Error("AMM config object could not be loaded from localnet.")

      const onChainSharedVersion = extractInitialSharedVersion(
        objectResponse.data
      )

      expect(onChainSharedVersion).toBe(output.initialSharedVersion)
    })
  })
})
