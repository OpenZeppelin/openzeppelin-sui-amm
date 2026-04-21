import { describe, expect, it } from "vitest"

import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import { MARKET_MAKER_TYPE_SUFFIX } from "@sui-amm/domain-core/models/traderAccount"
import {
  buildCreateMarketMakerTransaction,
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
import { DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID } from "../../../utils/amm.ts"

type AmmUpdateOutput = {
  ammConfig?: AmmConfigOverview
  ammConfigId?: string
  adminCapId?: string
  basePythPriceFeedIdHex?: string
  quotePythPriceFeedIdHex?: string
  transactionSummary?: { label?: string }
}

const UPDATED_PYTH_PRICE_FEED_ID_HEX =
  "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
const UPDATED_BASE_SPREAD_BPS = "55"
const UPDATED_VOLATILITY_SPREAD_BPS = "555"

const ZERO_POOL_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000"

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("owner amm-update integration", () => {
  it("updates a shared AMM market maker and returns the latest snapshot", async () => {
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

      const initialCreateTransaction = buildCreateMarketMakerTransaction({
        packageId: ammPackageId,
        poolId: ZERO_POOL_ID,
        senderAddress: publisher.address,
        baseSpreadBps: 25n,
        volatilitySpreadBps: 200n,
        basePythPriceFeedIdBytes: parsePythPriceFeedIdBytes(
          DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID
        ),
        quotePythPriceFeedIdBytes: parsePythPriceFeedIdBytes(
          DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID
        ),
        orderExpirationTimeMs: 86400000n,
        maxPriceAgeSecs: 60n,
        maxConfRatioBps: 1000n
      })

      const createResult = await context.signAndExecuteTransaction(
        initialCreateTransaction,
        publisher
      )
      await context.waitForFinality(createResult.digest)

      const ammConfigId = ensureCreatedObject(
        MARKET_MAKER_TYPE_SUFFIX,
        createResult
      ).objectId

      const adminCapId = ensureCreatedObject(
        AMM_ADMIN_CAP_TYPE_SUFFIX,
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
          volatilitySpreadBps: UPDATED_VOLATILITY_SPREAD_BPS,
          basePythPriceFeedId: UPDATED_PYTH_PRICE_FEED_ID_HEX
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
      expect(output.ammConfig.volatilitySpreadBps).toBe(
        UPDATED_VOLATILITY_SPREAD_BPS
      )
      expect(output.ammConfig.active).toBe(true)
      expect(normalizeHex(output.ammConfig.basePythPriceFeedIdHex)).toBe(
        normalizeHex(UPDATED_PYTH_PRICE_FEED_ID_HEX)
      )
      expect(normalizeHex(output.basePythPriceFeedIdHex ?? "")).toBe(
        normalizeHex(UPDATED_PYTH_PRICE_FEED_ID_HEX)
      )
    })
  })
})
