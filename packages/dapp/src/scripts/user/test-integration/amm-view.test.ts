import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import { EXECUTOR_TYPE_SUFFIX } from "@sui-amm/domain-core/models/traderAccount"
import {
  buildCreateExecutorTransaction,
  parsePythPriceFeedIdBytes
} from "@sui-amm/domain-core/ptb/amm"
import { normalizeHex } from "@sui-amm/tooling-core/hex"
import { extractInitialSharedVersion } from "@sui-amm/tooling-core/shared-object"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"
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

type AmmViewOutput = {
  ammConfig?: AmmConfigOverview
  initialSharedVersion?: string
}

type PublishArtifact = {
  digest: string
  isDependency?: boolean
  packageId: string
}

type CreatedAmmConfigSnapshot = {
  ammConfigId: string
  baseSpreadBps: bigint
  initialSharedVersion: string
  basePythPriceFeedIdHex: string
  volatilitySpreadBps: bigint
}

const ZERO_POOL_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000"

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

const pickRootPublishArtifact = (publishArtifacts: PublishArtifact[]) => {
  const rootPublishArtifact =
    publishArtifacts.find((publishArtifact) => !publishArtifact.isDependency) ??
    publishArtifacts[0]

  if (!rootPublishArtifact) {
    throw new Error("Expected at least one publish artifact.")
  }

  return rootPublishArtifact
}

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
      const rootArtifact = pickRootPublishArtifact(publishArtifacts)

      const createAmmConfig = async ({
        baseSpreadBps,
        volatilitySpreadBps,
        basePythPriceFeedIdHex
      }: Omit<
        CreatedAmmConfigSnapshot,
        "ammConfigId" | "initialSharedVersion"
      >) => {
        const createTransaction = buildCreateExecutorTransaction({
          packageId: rootArtifact.packageId,
          poolId: ZERO_POOL_ID,
          senderAddress: publisher.address,
          baseSpreadBps,
          volatilitySpreadBps,
          basePythPriceFeedIdBytes: parsePythPriceFeedIdBytes(
            basePythPriceFeedIdHex
          ),
          quotePythPriceFeedIdBytes: parsePythPriceFeedIdBytes(
            basePythPriceFeedIdHex
          ),
          orderExpirationTimeMs: 86400000n,
          maxPriceAgeSecs: 60n,
          maxConfRatioBps: 1000n
        })

        const createResult = await context.signAndExecuteTransaction(
          createTransaction,
          publisher
        )
        await context.waitForFinality(createResult.digest)

        const createdConfig = ensureCreatedObject(
          EXECUTOR_TYPE_SUFFIX,
          createResult
        )
        const initialSharedVersion = extractInitialSharedVersion(createdConfig)
        if (!initialSharedVersion) {
          throw new Error(
            "Expected AMM config to include shared version metadata."
          )
        }

        // Consume AdminCap to avoid unused object errors in subsequent transactions
        ensureCreatedObject(AMM_ADMIN_CAP_TYPE_SUFFIX, createResult)

        return {
          ammConfigId: createdConfig.objectId,
          baseSpreadBps,
          initialSharedVersion,
          basePythPriceFeedIdHex,
          volatilitySpreadBps
        }
      }

      await createAmmConfig({
        baseSpreadBps: 37n,
        volatilitySpreadBps: 420n,
        basePythPriceFeedIdHex: DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID
      })
      const latestAmmConfig = await createAmmConfig({
        baseSpreadBps: 58n,
        volatilitySpreadBps: 777n,
        basePythPriceFeedIdHex: DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID
      })

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
      if (!parsed.ammConfig) {
        throw new Error("amm-view output did not include ammConfig.")
      }
      if (!parsed.initialSharedVersion) {
        throw new Error("amm-view output did not include shared version.")
      }

      expect(parsed.ammConfig.configId).toBe(latestAmmConfig.ammConfigId)
      expect(parsed.ammConfig.baseSpreadBps).toBe(
        latestAmmConfig.baseSpreadBps.toString()
      )
      expect(parsed.ammConfig.volatilitySpreadBps).toBe(
        latestAmmConfig.volatilitySpreadBps.toString()
      )
      expect(parsed.ammConfig.active).toBe(true)
      expect(normalizeHex(parsed.ammConfig.basePythPriceFeedIdHex)).toBe(
        normalizeHex(latestAmmConfig.basePythPriceFeedIdHex)
      )
      expect(parsed.initialSharedVersion).toBe(
        latestAmmConfig.initialSharedVersion
      )
    })
  })
})
