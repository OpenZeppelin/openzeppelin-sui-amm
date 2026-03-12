import { describe, expect, it } from "vitest"

import { normalizeHex } from "@sui-amm/tooling-core/hex"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import { DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID } from "../../../utils/amm.ts"
import {
  parseAmmSeedOutput,
  requireAmmSeedOutput,
  runAmmSeedScript,
  type AmmSeedScriptArguments,
  type CompleteAmmSeedOutput
} from "./helpers.ts"
import {
  resolveKeepTemp,
  resolveOnChainSharedVersion,
  resolveWithFaucet
} from "./test-helpers.ts"

const SEEDED_BASE_SPREAD_BPS = "37"
const SEEDED_VOLATILITY_MULTIPLIER_BPS = "420"
const SEEDED_USE_LASER = true
const SEEDED_PYTH_PRICE_FEED_ID = DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID

const SEED_ARGS: AmmSeedScriptArguments = {
  json: true,
  baseSpreadBps: SEEDED_BASE_SPREAD_BPS,
  volatilityMultiplierBps: SEEDED_VOLATILITY_MULTIPLIER_BPS,
  useLaser: SEEDED_USE_LASER,
  pythPriceFeedId: SEEDED_PYTH_PRICE_FEED_ID
}

const expectSeededAmmConfigValues = (output: CompleteAmmSeedOutput) => {
  expect(output.ammConfigId).toBe(output.ammConfig.configId)
  expect(output.ammConfig.baseSpreadBps).toBe(SEEDED_BASE_SPREAD_BPS)
  expect(output.ammConfig.volatilityMultiplierBps).toBe(
    SEEDED_VOLATILITY_MULTIPLIER_BPS
  )
  expect(output.ammConfig.useLaser).toBe(SEEDED_USE_LASER)
  expect(output.ammConfig.tradingPaused).toBe(false)
  expect(normalizeHex(output.ammConfig.pythPriceFeedIdHex)).toBe(
    normalizeHex(SEEDED_PYTH_PRICE_FEED_ID)
  )
  const { pythPriceFeedIdHex } = output
  expect(pythPriceFeedIdHex).toBeDefined()
  // @ts-expect-error Would have throw before so it is defined
  expect(normalizeHex(pythPriceFeedIdHex)).toBe(
    normalizeHex(SEEDED_PYTH_PRICE_FEED_ID)
  )
}

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

      const result = await runAmmSeedScript(context, publisher, SEED_ARGS)

      expect(result.exitCode).toBe(0)

      const output = requireAmmSeedOutput(parseAmmSeedOutput(result.stdout))

      expect(output.didPublish).toBe(true)
      expect(output.didCreateAmmConfig).toBe(true)
      expect(output.publishDigest).toBeTruthy()
      expect(output.transactionSummary?.label).toBe("create-amm")
      expectSeededAmmConfigValues(output)

      const onChainSharedVersion = await resolveOnChainSharedVersion(
        context,
        output.ammConfig.configId
      )
      expect(onChainSharedVersion).toBe(output.initialSharedVersion)
    })
  })

  it("reuses the existing AMM package and config on a second seed run", async () => {
    await testEnv.withTestContext("owner-amm-seed-reuse", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const firstResult = await runAmmSeedScript(context, publisher, SEED_ARGS)

      expect(firstResult.exitCode).toBe(0)

      const firstOutput = requireAmmSeedOutput(
        parseAmmSeedOutput(firstResult.stdout)
      )

      const secondResult = await runAmmSeedScript(context, publisher, {
        json: true
      })

      expect(secondResult.exitCode).toBe(0)

      const secondOutput = requireAmmSeedOutput(
        parseAmmSeedOutput(secondResult.stdout)
      )

      expect(secondOutput.didPublish).toBe(false)
      expect(secondOutput.didCreateAmmConfig).toBe(false)
      expect(secondOutput.publishDigest).toBeUndefined()
      expect(secondOutput.transactionSummary).toBeUndefined()
      expect(secondOutput.ammPackageId).toBe(firstOutput.ammPackageId)
      expect(secondOutput.ammConfigId).toBe(firstOutput.ammConfigId)
      expect(secondOutput.initialSharedVersion).toBe(
        firstOutput.initialSharedVersion
      )
      expectSeededAmmConfigValues(secondOutput)

      const onChainSharedVersion = await resolveOnChainSharedVersion(
        context,
        secondOutput.ammConfig.configId
      )
      expect(onChainSharedVersion).toBe(secondOutput.initialSharedVersion)
    })
  })
})
