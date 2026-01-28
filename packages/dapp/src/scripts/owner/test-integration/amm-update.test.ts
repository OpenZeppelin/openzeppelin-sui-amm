import { describe, expect, it } from "vitest"

import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  AMM_CONFIG_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import { DEFAULT_MOCK_PRICE_FEED } from "@sui-amm/domain-core/models/pyth"
import {
  buildClaimAmmAdminCapTransaction,
  buildCreateAmmConfigTransaction,
  parsePythPriceFeedIdBytes
} from "@sui-amm/domain-core/ptb/amm"
import { normalizeHex } from "@sui-amm/tooling-core/hex"
import { getAllOwnedObjectsByFilter } from "@sui-amm/tooling-core/object"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/artifacts"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput,
  resolveOwnerScriptPath
} from "@sui-amm/tooling-node/testing/scripts"
import { resolveAmmAdminCapStoreIdFromPublishDigest } from "../../../utils/amm.ts"

type AmmUpdateOutput = {
  ammConfig?: AmmConfigOverview
  ammConfigId?: string
  adminCapId?: string
  pythPriceFeedIdHex?: string
  transactionSummary?: { label?: string }
}

const resolveKeepTemp = () => process.env.SUI_IT_KEEP_TEMP === "1"

const resolveWithFaucet = () => process.env.SUI_IT_WITH_FAUCET !== "0"

const UPDATED_PYTH_PRICE_FEED_ID_HEX =
  "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

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
        { withUnpublishedDependencies: true }
      )
      const rootArtifact = pickRootNonDependencyArtifact(publishArtifacts)
      const ammPackageId = rootArtifact.packageId

      await context.waitForFinality(rootArtifact.digest)

      const adminCapStoreId = await resolveAmmAdminCapStoreIdFromPublishDigest({
        publishDigest: rootArtifact.digest,
        suiClient: context.suiClient
      })
      const adminCapStore = await getSuiSharedObject(
        {
          objectId: adminCapStoreId,
          mutable: true
        },
        { suiClient: context.suiClient }
      )

      const claimAdminCapTransaction = buildClaimAmmAdminCapTransaction({
        packageId: ammPackageId,
        adminCapStore
      })
      const claimResult = await context.signAndExecuteTransaction(
        claimAdminCapTransaction,
        publisher
      )
      await context.waitForFinality(claimResult.digest)

      const adminCaps = await getAllOwnedObjectsByFilter(
        {
          ownerAddress: publisher.address,
          filter: {
            StructType: `${ammPackageId}${AMM_ADMIN_CAP_TYPE_SUFFIX}`
          }
        },
        { suiClient: context.suiClient }
      )

      const adminCapId = adminCaps[0]?.objectId
      if (!adminCapId)
        throw new Error(
          "Expected AMM admin cap to be claimed for the publisher."
        )

      const initialConfigTransaction = buildCreateAmmConfigTransaction({
        packageId: ammPackageId,
        baseSpreadBps: 25n,
        volatilityMultiplierBps: 200n,
        useLaser: false,
        pythPriceFeedIdBytes: parsePythPriceFeedIdBytes(
          DEFAULT_MOCK_PRICE_FEED.feedIdHex
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
      const result = await scriptRunner.runScript(
        resolveOwnerScriptPath("amm-update"),
        {
          account: publisher,
          args: {
            json: true,
            ammPackageId,
            ammConfigId,
            adminCapId,
            baseSpreadBps: "55",
            volatilityMultiplierBps: "555",
            useLaser: true,
            tradingPaused: true,
            pythPriceFeedId: UPDATED_PYTH_PRICE_FEED_ID_HEX
          }
        }
      )

      expect(result.exitCode).toBe(0)

      const output = parseJsonFromScriptOutput<AmmUpdateOutput>(
        result.stdout,
        "amm-update output"
      )
      if (!output.ammConfig)
        throw new Error("amm-update output did not include ammConfig.")

      expect(output.transactionSummary?.label).toBe("update-amm")
      expect(output.ammConfigId).toBe(ammConfigId)
      expect(output.adminCapId).toBe(adminCapId)
      expect(output.ammConfig.configId).toBe(ammConfigId)
      expect(output.ammConfig.baseSpreadBps).toBe("55")
      expect(output.ammConfig.volatilityMultiplierBps).toBe("555")
      expect(output.ammConfig.useLaser).toBe(true)
      expect(output.ammConfig.tradingPaused).toBe(true)
      expect(normalizeHex(output.ammConfig.pythPriceFeedIdHex)).toBe(
        normalizeHex(UPDATED_PYTH_PRICE_FEED_ID_HEX)
      )
      expect(normalizeHex(output.pythPriceFeedIdHex ?? "")).toBe(
        normalizeHex(UPDATED_PYTH_PRICE_FEED_ID_HEX)
      )
    })
  })
})
