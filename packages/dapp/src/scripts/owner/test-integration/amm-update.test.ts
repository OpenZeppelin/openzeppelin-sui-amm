import { describe, expect, it } from "vitest"

import {
  AMM_CONFIG_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import {
  buildCreateAmmConfigTransaction,
  parsePythPriceFeedIdBytes
} from "@sui-amm/domain-core/ptb/amm"
import { normalizeHex } from "@sui-amm/tooling-core/hex"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/package"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"
import {
  DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID,
  resolveAmmAdminCapIdFromPublishDigest
} from "../../../utils/amm.ts"
import { resolveKeepTemp, resolveWithFaucet } from "./test-helpers.ts"

type AmmUpdateOutput = {
  ammConfig?: AmmConfigOverview
  ammConfigId?: string
  adminCapId?: string
  pythPriceFeedIdHex?: string
  transactionSummary?: { label?: string }
}

const UPDATED_PYTH_PRICE_FEED_ID_HEX =
  "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
const UPDATED_BASE_SPREAD_BPS = "55"
const UPDATED_VOLATILITY_MULTIPLIER_BPS = "555"
const UPDATED_USE_LASER = true
const UPDATED_TRADING_PAUSED = true

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  keepTemp: resolveKeepTemp(),
  withFaucet: resolveWithFaucet(),
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("owner amm-update integration", () => {
  it("updates a shared AMM config and returns the latest snapshot", async () => {
    await testEnv.withTestContext("owner-amm-update", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const publishArtifacts = await context.publishPackage(
        "prop-amm",
        publisher,
        {
          withUnpublishedDependencies: true
        }
      )
      const rootArtifact = pickRootNonDependencyArtifact(publishArtifacts)
      const ammPackageId = rootArtifact.packageId

      await context.waitForFinality(rootArtifact.digest)

      const adminCapId = await resolveAmmAdminCapIdFromPublishDigest({
        publishDigest: rootArtifact.digest,
        suiClient: context.suiClient
      })

      const initialConfigTransaction = buildCreateAmmConfigTransaction({
        packageId: ammPackageId,
        adminCapId,
        baseSpreadBps: 25n,
        volatilityMultiplierBps: 200n,
        useLaser: false,
        pythPriceFeedIdBytes: parsePythPriceFeedIdBytes(
          DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID
        )
      })

      const createResult = await context.signAndExecuteTransaction(
        initialConfigTransaction,
        publisher
      )
      await context.waitForFinality(createResult.digest)

      const ammConfigId = ensureCreatedObject(
        AMM_CONFIG_TYPE_SUFFIX,
        createResult
      ).objectId

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runOwnerScript("amm-update", {
        account: publisher,
        args: {
          json: true,
          ammPackageId,
          ammConfigId,
          adminCapId,
          baseSpreadBps: UPDATED_BASE_SPREAD_BPS,
          volatilityMultiplierBps: UPDATED_VOLATILITY_MULTIPLIER_BPS,
          useLaser: UPDATED_USE_LASER,
          tradingPaused: UPDATED_TRADING_PAUSED,
          pythPriceFeedId: UPDATED_PYTH_PRICE_FEED_ID_HEX
        }
      })

      expect(result.exitCode).toBe(0)

      const output = parseJsonFromScriptOutput<AmmUpdateOutput>(
        result.stdout,
        "amm-update output"
      )
      if (!output.ammConfig) {
        throw new Error("amm-update output did not include ammConfig.")
      }

      expect(output.transactionSummary?.label).toBe("update-amm")
      expect(output.ammConfigId).toBe(ammConfigId)
      expect(output.adminCapId).toBe(adminCapId)
      expect(output.ammConfig.configId).toBe(ammConfigId)
      expect(output.ammConfig.baseSpreadBps).toBe(UPDATED_BASE_SPREAD_BPS)
      expect(output.ammConfig.volatilityMultiplierBps).toBe(
        UPDATED_VOLATILITY_MULTIPLIER_BPS
      )
      expect(output.ammConfig.useLaser).toBe(UPDATED_USE_LASER)
      expect(output.ammConfig.tradingPaused).toBe(UPDATED_TRADING_PAUSED)
      expect(normalizeHex(output.ammConfig.pythPriceFeedIdHex)).toBe(
        normalizeHex(UPDATED_PYTH_PRICE_FEED_ID_HEX)
      )
      expect(normalizeHex(output.pythPriceFeedIdHex ?? "")).toBe(
        normalizeHex(UPDATED_PYTH_PRICE_FEED_ID_HEX)
      )
    })
  })
})
