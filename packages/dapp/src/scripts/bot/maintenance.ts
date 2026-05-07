/**
 * Localnet-only. Runs `executor::refresh_quotes_permissionless` on a fixed
 * cadence so the AMM keeps its DeepBook orders in sync with the latest mock
 * Pyth price (whatever `bot:market-activity` — or any other publisher —
 * has walked it to).
 *
 * Each tick (one PTB per executor, one signature each):
 *   1. Re-read both `PriceInfoObject`s and re-stamp them with the SAME
 *      magnitude/expo/conf so only the `timestamp` advances. Without that
 *      bump, the executor's `assert_price_age_within_limit` aborts after
 *      `max_price_age_secs`.
 *   2. Call `refresh_quotes_permissionless<Base, Quote>` so the executor
 *      cancels its previous orders and re-posts around the now-fresh price.
 *
 * Configuration:
 *   - `--executor-id` (optional): single executor to maintain. When omitted,
 *     the loop discovers every executor ever created from the AMM package
 *     by scanning `ExecutorCreated` events and refreshes each per tick.
 *   - `--pool-id` (optional): only honored in single-executor mode; defaults
 *     to the executor's bound `poolId`. In auto-discovery mode each
 *     executor's pool comes from its own `Market.pool_id`.
 *   - `--interval-ms` (default 5000): tick cadence.
 *   - Signer is `MARKET_ACTIVITY_PRIVATE_KEY` from `packages/dapp/.env`.
 *
 * Code reuse: the PTB is built via the same
 * `buildLocalnetRefreshQuotesTransaction` helper the UI's Refresh Quotes
 * button uses, and the `magnitude/expo/conf` reader is the shared
 * `readPythPriceComponentsFromContent`. The executor's coin types, Pyth
 * feed ids, and pool id all come from `getTraderAccountOverview` —
 * `Executor` has no generic parameters; both type tags live in
 * `Market.{base,quote}`.
 */

import { SuiPythClient } from "@pythnetwork/pyth-sui-js"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { readPythPriceComponentsFromContent } from "@sui-amm/domain-core/models/pyth"
import { getTraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import { buildLocalnetRefreshQuotesTransaction } from "@sui-amm/domain-core/ptb/amm"
import { assertLocalnetNetwork } from "@sui-amm/tooling-core/network"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import {
  loadDeploymentArtifacts,
  readArtifact
} from "@sui-amm/tooling-node/artifacts"
import { loadKeypair } from "@sui-amm/tooling-node/keypair"
import { logKeyValueGreen, logWarning } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import type { SuiClient } from "@mysten/sui/client"

import { mockArtifactPath, type MockArtifact } from "../../utils/mocks.ts"

type ExecutorContext = {
  executorId: string
  poolId: string
  baseCoinType: string
  quoteCoinType: string
  basePriceInfoObjectId: string
  quotePriceInfoObjectId: string
}

process.env.SUI_NETWORK = "localnet"

const AMM_PACKAGE_NAME = "openzeppelin_market_maker"

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const requireMockField = <T>(value: T | undefined, label: string): T => {
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `${label} is missing from mock.localnet.json. Run \`pnpm --filter dapp mock:setup\` first.`
    )
  }
  return value
}

// Pull every executor ever created from this AMM package by scanning
// `ExecutorCreated` events. Returns ids in creation order so a tick
// processes oldest-first (deterministic logs across runs).
const discoverExecutorIds = async (
  ammPackageId: string,
  suiClient: SuiClient
): Promise<string[]> => {
  const ids = new Set<string>()
  let cursor: { txDigest: string; eventSeq: string } | null | undefined =
    undefined
  while (true) {
    const page = await suiClient.queryEvents({
      query: {
        MoveEventType: `${ammPackageId}::events::ExecutorCreated`
      },
      cursor,
      order: "ascending",
      limit: 200
    })
    for (const event of page.data) {
      const data = event.parsedJson as { executor_id?: unknown } | undefined
      if (typeof data?.executor_id !== "string") continue
      ids.add(normalizeSuiObjectId(data.executor_id))
    }
    if (!page.hasNextPage || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return [...ids]
}

// Resolve a single executor's coin types, pool id, and PriceInfoObject ids.
// Result is cached across ticks (the inputs are immutable for an executor's
// lifetime), so each subsequent tick only needs the four `getSuiSharedObject`
// reads inside the per-executor refresh path.
const buildExecutorContext = async (
  executorId: string,
  ammPackageId: string,
  pythStateId: string,
  pythClient: SuiPythClient,
  suiClient: SuiClient,
  poolIdOverride?: string
): Promise<ExecutorContext> => {
  const overview = await getTraderAccountOverview(
    executorId,
    suiClient,
    ammPackageId
  )
  const [basePriceInfoObjectId, quotePriceInfoObjectId] = await Promise.all([
    pythClient.getPriceFeedObjectId(overview.basePythPriceFeedIdHex),
    pythClient.getPriceFeedObjectId(overview.quotePythPriceFeedIdHex)
  ])
  if (!basePriceInfoObjectId || !quotePriceInfoObjectId) {
    throw new Error(
      `Pyth state ${pythStateId} has no PriceInfoObject for ${
        !basePriceInfoObjectId ? `base ${overview.basePythPriceFeedIdHex}` : ""
      } ${
        !quotePriceInfoObjectId
          ? `quote ${overview.quotePythPriceFeedIdHex}`
          : ""
      }`.trim()
    )
  }
  // Surface a mismatch loudly: passing --pool-id that doesn't match the
  // executor's bound pool will route every refresh into the wrong market,
  // and the most common cause is a stale flag the operator forgot to drop.
  if (poolIdOverride && poolIdOverride !== overview.poolId) {
    logWarning(
      `--pool-id ${poolIdOverride} overrides executor ${executorId}'s bound pool ${overview.poolId}; refresh ticks will target the override.`
    )
  }
  return {
    executorId,
    poolId: poolIdOverride ?? overview.poolId,
    baseCoinType: overview.baseCoinType,
    quoteCoinType: overview.quoteCoinType,
    basePriceInfoObjectId,
    quotePriceInfoObjectId
  }
}

runSuiScript(
  async (tooling, cliArguments) => {
    assertLocalnetNetwork(tooling.suiConfig.network.networkName)

    const intervalMs = cliArguments.intervalMs
    const explicitExecutorId = cliArguments.executorId

    const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
    const pythPackageId = requireMockField(
      mockArtifact.pythPackageId,
      "pythPackageId"
    )
    const pythStateId = requireMockField(
      mockArtifact.pythStateId,
      "pythStateId"
    )

    // Look up the most recent `openzeppelin_market_maker` publish so the
    // overview's `expectedType` check matches the currently-bound executor.
    const deploymentRecords = await loadDeploymentArtifacts(
      tooling.suiConfig.network.networkName
    )
    const ammRecord = [...deploymentRecords]
      .reverse()
      .find((entry) => entry.packageName === AMM_PACKAGE_NAME)
    if (!ammRecord?.packageId) {
      throw new Error(
        `No \`${AMM_PACKAGE_NAME}\` publish recorded in deployment.localnet.json. Run \`pnpm --filter dapp move:publish --package-path prop-amm\` first.`
      )
    }
    const ammPackageId = ammRecord.packageId

    const botPrivateKey = process.env.MARKET_ACTIVITY_PRIVATE_KEY?.trim()
    if (!botPrivateKey) {
      throw new Error(
        "MARKET_ACTIVITY_PRIVATE_KEY is not set in packages/dapp/.env — the maintenance loop needs a dedicated bot signer."
      )
    }
    const signer = await loadKeypair({ accountPrivateKey: botPrivateKey })
    const ownerAddress = signer.toSuiAddress()
    // Top up gas via the localnet faucet so the first refresh has SUI to spend.
    await tooling.ensureFoundedAddress({ signerAddress: ownerAddress, signer })

    const pythClient = new SuiPythClient(
      tooling.suiClient,
      pythStateId,
      pythStateId
    )

    // Cached per-executor context (coin types, pool, PriceInfoObject ids).
    // Inputs are immutable for an executor's lifetime, so we resolve once and
    // reuse — only the four shared-object reads run every tick per executor.
    const contextByExecutorId = new Map<string, ExecutorContext>()

    const ensureContext = async (
      executorId: string
    ): Promise<ExecutorContext> => {
      const cached = contextByExecutorId.get(executorId)
      if (cached) return cached
      const context = await buildExecutorContext(
        executorId,
        ammPackageId,
        pythStateId,
        pythClient,
        tooling.suiClient,
        // --pool-id only overrides in single-executor mode; in auto-discovery
        // each executor's bound pool comes from its own Market.pool_id.
        explicitExecutorId ? cliArguments.poolId : undefined
      )
      contextByExecutorId.set(executorId, context)
      return context
    }

    const refreshExecutor = async (tick: number, context: ExecutorContext) => {
      // Re-fetch all four shared objects each tick so the price content is
      // fresh (the market-activity bot may have walked it since the last
      // refresh). Cheap on localnet — four `getObject` calls in parallel.
      const [executorShared, poolShared, basePriceInfo, quotePriceInfo] =
        await Promise.all([
          getSuiSharedObject(
            { objectId: context.executorId, mutable: true },
            { suiClient: tooling.suiClient }
          ),
          getSuiSharedObject(
            { objectId: context.poolId, mutable: true },
            { suiClient: tooling.suiClient }
          ),
          getSuiSharedObject(
            { objectId: context.basePriceInfoObjectId, mutable: true },
            { suiClient: tooling.suiClient }
          ),
          getSuiSharedObject(
            { objectId: context.quotePriceInfoObjectId, mutable: true },
            { suiClient: tooling.suiClient }
          )
        ])
      const basePriceComponents = readPythPriceComponentsFromContent(
        basePriceInfo.object.content
      )
      const quotePriceComponents = readPythPriceComponentsFromContent(
        quotePriceInfo.object.content
      )

      const transaction = buildLocalnetRefreshQuotesTransaction({
        packageId: ammPackageId,
        executor: executorShared,
        pool: poolShared,
        baseAssetTypeTag: context.baseCoinType,
        quoteAssetTypeTag: context.quoteCoinType,
        pythMockPackageId: pythPackageId,
        basePriceInfoObject: basePriceInfo,
        quotePriceInfoObject: quotePriceInfo,
        basePriceComponents,
        quotePriceComponents
      })

      const { transactionResult } = await tooling.signAndExecute({
        transaction,
        signer,
        // Refresh quotes mutates the executor + Pyth feeds; nothing useful
        // gets created. Skip the artifact write so two concurrent loops
        // (e.g. this one + market-activity) can't corrupt the ledger.
        persistCreatedObjects: false
      })
      logKeyValueGreen(`tick ${tick}`)(
        `executor ${context.executorId} refreshed · digest=${transactionResult.digest}`
      )
    }

    logKeyValueGreen("amm-package")(ammPackageId)
    logKeyValueGreen("signer")(ownerAddress)
    logKeyValueGreen("interval-ms")(String(intervalMs))
    if (explicitExecutorId) {
      logKeyValueGreen("mode")(`single (--executor-id ${explicitExecutorId})`)
    } else {
      logKeyValueGreen("mode")(
        "auto-discovery (every tick: scan ExecutorCreated events + refresh each)"
      )
    }

    let tick = 0
    while (true) {
      tick += 1

      let executorIds: string[]
      try {
        // Branch on `explicitExecutorId` directly so TS narrows it to `string`
        // inside the truthy branch (no non-null assertion needed).
        executorIds = explicitExecutorId
          ? [explicitExecutorId]
          : await discoverExecutorIds(ammPackageId, tooling.suiClient)
      } catch (error) {
        logWarning(
          `tick ${tick} discovery failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        await sleep(intervalMs)
        continue
      }

      if (executorIds.length === 0) {
        logWarning(
          `tick ${tick}: no executors found yet (no ExecutorCreated events from ${ammPackageId}). Waiting…`
        )
        await sleep(intervalMs)
        continue
      }

      for (const executorId of executorIds) {
        try {
          const context = await ensureContext(executorId)
          await refreshExecutor(tick, context)
        } catch (error) {
          logWarning(
            `tick ${tick} executor ${executorId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      }
      await sleep(intervalMs)
    }
  },
  yargs()
    .option("executorId", {
      alias: ["executor-id", "executor"],
      type: "string",
      description:
        "AMM Executor shared-object id whose quotes should be refreshed each tick."
    })
    .option("poolId", {
      alias: ["pool-id", "pool"],
      type: "string",
      description:
        "DeepBook pool object id. Only honored alongside --executor-id (override of the executor's bound pool); ignored in auto-discovery mode where each executor's pool comes from its own Market.pool_id."
    })
    .option("intervalMs", {
      alias: ["interval-ms", "interval"],
      type: "number",
      description:
        "Delay between refresh_quotes_permissionless calls, in milliseconds.",
      default: 5000
    })
    .strict()
)
