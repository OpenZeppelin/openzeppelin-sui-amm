/**
 * Localnet-only. Runs `executor::refresh_quotes_permissionless` on a fixed
 * cadence so the AMM keeps its DeepBook orders in sync with the latest mock
 * Pyth price (whatever `bot:market-activity` — or any other publisher —
 * has walked it to).
 *
 * Each tick (single PTB, one signature):
 *   1. Re-read both `PriceInfoObject`s and re-stamp them with the SAME
 *      magnitude/expo/conf so only the `timestamp` advances. Without that
 *      bump, the executor's `assert_price_age_within_limit` aborts after
 *      `max_price_age_secs`.
 *   2. Call `refresh_quotes_permissionless<Base, Quote>` so the executor
 *      cancels its previous orders and re-posts around the now-fresh price.
 *
 * Configuration:
 *   - `--executor-id` (required): the AMM `Executor` shared-object id.
 *   - `--pool-id` (optional): defaults to `pools[0].poolId` from
 *     `packages/dapp/deployments/mock.localnet.json`.
 *   - `--interval-ms` (default 5000): tick cadence.
 *   - Signer is `MARKET_ACTIVITY_PRIVATE_KEY` from `packages/dapp/.env`.
 *
 * Code reuse: the PTB is built via the same
 * `buildLocalnetRefreshQuotesTransaction` helper the UI's Refresh Quotes
 * button uses, and the `magnitude/expo/conf` reader is the shared
 * `readPythPriceComponentsFromContent`. The executor's coin types and
 * Pyth feed ids come from `getTraderAccountOverview` instead of being
 * parsed locally — `Executor` has no generic parameters; both type tags
 * live in `Market.{base,quote}`.
 */

import { SuiPythClient } from "@pythnetwork/pyth-sui-js"
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

import { mockArtifactPath, type MockArtifact } from "../../utils/mocks.ts"

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

runSuiScript(
  async (tooling, cliArguments) => {
    assertLocalnetNetwork(tooling.suiConfig.network.networkName)

    const intervalMs = cliArguments.intervalMs
    const executorId = cliArguments.executorId
    if (!executorId) {
      throw new Error(
        "--executor-id is required. Pass the shared-object id of the AMM Executor you want to maintain."
      )
    }

    const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
    const pythPackageId = requireMockField(
      mockArtifact.pythPackageId,
      "pythPackageId"
    )
    const pythStateId = requireMockField(mockArtifact.pythStateId, "pythStateId")
    const poolId =
      cliArguments.poolId ??
      requireMockField(mockArtifact.pools?.[0]?.poolId, "pools[0].poolId")

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

    // Pull the executor's `<Base, Quote>` coin types and Pyth feed ids from the
    // same `getTraderAccountOverview` helper the UI uses — the `Executor`
    // struct has no generic params, so coin types come from `Market.{base,quote}`.
    const overview = await getTraderAccountOverview(
      executorId,
      tooling.suiClient,
      ammPackageId
    )

    const pythClient = new SuiPythClient(
      tooling.suiClient,
      pythStateId,
      pythStateId
    )
    const [basePriceInfoObjectId, quotePriceInfoObjectId] = await Promise.all([
      pythClient.getPriceFeedObjectId(overview.basePythPriceFeedIdHex),
      pythClient.getPriceFeedObjectId(overview.quotePythPriceFeedIdHex)
    ])
    if (!basePriceInfoObjectId || !quotePriceInfoObjectId) {
      throw new Error(
        `Pyth state ${pythStateId} has no PriceInfoObject for ${
          !basePriceInfoObjectId
            ? `base ${overview.basePythPriceFeedIdHex}`
            : ""
        } ${
          !quotePriceInfoObjectId
            ? `quote ${overview.quotePythPriceFeedIdHex}`
            : ""
        }`.trim()
      )
    }

    logKeyValueGreen("executor")(executorId)
    logKeyValueGreen("pool")(poolId)
    logKeyValueGreen("signer")(ownerAddress)
    logKeyValueGreen("base-feed")(overview.basePythPriceFeedIdHex)
    logKeyValueGreen("quote-feed")(overview.quotePythPriceFeedIdHex)
    logKeyValueGreen("interval-ms")(String(intervalMs))

    let tick = 0
    while (true) {
      tick += 1
      try {
        // Re-fetch all four shared objects each tick so the price content is
        // fresh (the market-activity bot may have walked it since the last
        // refresh). Cheap on localnet — four `getObject` calls in parallel.
        const [executorShared, poolShared, basePriceInfo, quotePriceInfo] =
          await Promise.all([
            getSuiSharedObject(
              { objectId: executorId, mutable: true },
              { suiClient: tooling.suiClient }
            ),
            getSuiSharedObject(
              { objectId: poolId, mutable: true },
              { suiClient: tooling.suiClient }
            ),
            getSuiSharedObject(
              { objectId: basePriceInfoObjectId, mutable: true },
              { suiClient: tooling.suiClient }
            ),
            getSuiSharedObject(
              { objectId: quotePriceInfoObjectId, mutable: true },
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
          baseAssetTypeTag: overview.baseCoinType,
          quoteAssetTypeTag: overview.quoteCoinType,
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
          `refreshed · digest=${transactionResult.digest}`
        )
      } catch (error) {
        logWarning(
          `tick ${tick} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
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
        "DeepBook pool object id; defaults to pools[0].poolId from mock.localnet.json."
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
