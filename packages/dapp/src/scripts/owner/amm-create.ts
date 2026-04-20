/**
 * Creates a new shared AMM market maker for the target network.
 */
import yargs from "yargs"

import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  AMM_CONFIG_TYPE_SUFFIX,
  DEFAULT_BASE_SPREAD_BPS,
  DEFAULT_MAX_CONF_RATIO_BPS,
  DEFAULT_MAX_PRICE_AGE_SECS,
  DEFAULT_ORDER_EXPIRATION_TIME_MS,
  DEFAULT_VOLATILITY_SPREAD_BPS,
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildCreateMarketMakerTransaction } from "@sui-amm/domain-core/ptb/amm"
import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { findCreatedArtifactBySuffix } from "@sui-amm/tooling-node/transactions"
import {
  logAmmConfigOverview,
  resolvePythPriceFeedIdHex
} from "../../utils/amm.ts"

const ZERO_POOL_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000"

type CreateAmmArguments = {
  poolId?: string
  baseSpreadBps?: string
  volatilitySpreadBps?: string
  basePythPriceFeedId?: string
  quotePythPriceFeedId?: string
  pythPriceFeedLabel?: string
  orderExpirationTimeMs?: string
  maxPriceAgeSecs?: string
  maxConfRatioBps?: string
  ammPackageId?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

runSuiScript(
  async (tooling: Tooling, cliArguments: CreateAmmArguments) => {
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })

    const poolId = cliArguments.poolId?.trim() || ZERO_POOL_ID

    const basePythPriceFeedIdHex = await resolvePythPriceFeedIdHex({
      networkName: tooling.network.networkName,
      pythPriceFeedId: cliArguments.basePythPriceFeedId,
      pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
    })
    const quotePythPriceFeedIdHex = cliArguments.quotePythPriceFeedId?.trim()
      ? cliArguments.quotePythPriceFeedId.trim()
      : basePythPriceFeedIdHex

    const ammConfigInputs = resolveAmmConfigInputs({
      basePythPriceFeedIdHex,
      quotePythPriceFeedIdHex,
      volatilitySpreadBps: cliArguments.volatilitySpreadBps,
      baseSpreadBps: cliArguments.baseSpreadBps,
      orderExpirationTimeMs: cliArguments.orderExpirationTimeMs,
      maxPriceAgeSecs: cliArguments.maxPriceAgeSecs,
      maxConfRatioBps: cliArguments.maxConfRatioBps
    })

    const senderAddress = tooling.loadedEd25519KeyPair.toSuiAddress()

    const createMarketMakerTransaction = buildCreateMarketMakerTransaction({
      packageId: ammPackageId,
      poolId,
      senderAddress,
      baseSpreadBps: ammConfigInputs.baseSpreadBps,
      volatilitySpreadBps: ammConfigInputs.volatilitySpreadBps,
      basePythPriceFeedIdBytes: ammConfigInputs.basePythPriceFeedIdBytes,
      quotePythPriceFeedIdBytes: ammConfigInputs.quotePythPriceFeedIdBytes,
      orderExpirationTimeMs: ammConfigInputs.orderExpirationTimeMs,
      maxPriceAgeSecs: ammConfigInputs.maxPriceAgeSecs,
      maxConfRatioBps: ammConfigInputs.maxConfRatioBps
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: createMarketMakerTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "create-amm",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) {
      return
    }

    const createdArtifacts = execution.objectArtifacts.created
    const createdMarketMaker = findCreatedArtifactBySuffix(
      createdArtifacts,
      AMM_CONFIG_TYPE_SUFFIX
    )
    const createdAdminCap = findCreatedArtifactBySuffix(
      createdArtifacts,
      AMM_ADMIN_CAP_TYPE_SUFFIX
    )

    if (!createdMarketMaker) {
      throw new Error(
        "Expected a MarketMaker object to be created, but it was not found in transaction artifacts."
      )
    }
    if (!createdAdminCap) {
      throw new Error(
        "Expected an AdminCap object to be created, but it was not found in transaction artifacts."
      )
    }

    const ammConfigOverview = await getAmmConfigOverview(
      createdMarketMaker.objectId,
      tooling.suiClient
    )

    if (
      emitJsonOutput(
        {
          ammConfig: ammConfigOverview,
          adminCapId: createdAdminCap.objectId,
          digest: createdMarketMaker.digest,
          initialSharedVersion: createdMarketMaker.initialSharedVersion,
          basePythPriceFeedIdHex: ammConfigInputs.basePythPriceFeedIdHex,
          quotePythPriceFeedIdHex: ammConfigInputs.quotePythPriceFeedIdHex,
          transactionSummary: summary
        },
        cliArguments.json
      )
    ) {
      return
    }

    logAmmConfigOverview(ammConfigOverview, {
      initialSharedVersion: createdMarketMaker.initialSharedVersion
    })
  },
  yargs()
    .option("poolId", {
      alias: ["pool-id"],
      type: "string",
      description:
        "DeepBook pool object id for the market maker; defaults to zero address when omitted (for testing).",
      demandOption: false
    })
    .option("baseSpreadBps", {
      alias: ["base-spread-bps"],
      type: "string",
      description: "Base spread in basis points (u64).",
      default: DEFAULT_BASE_SPREAD_BPS,
      demandOption: false
    })
    .option("volatilitySpreadBps", {
      alias: ["volatility-spread-bps"],
      type: "string",
      description: "Volatility spread in basis points (u64).",
      default: DEFAULT_VOLATILITY_SPREAD_BPS,
      demandOption: false
    })
    .option("basePythPriceFeedId", {
      alias: ["base-pyth-price-feed-id", "pyth-price-feed-id", "pyth-feed-id"],
      type: "string",
      description: "Base asset Pyth price feed id (32 bytes hex).",
      demandOption: false
    })
    .option("quotePythPriceFeedId", {
      alias: ["quote-pyth-price-feed-id"],
      type: "string",
      description:
        "Quote asset Pyth price feed id (32 bytes hex); defaults to base feed when omitted.",
      demandOption: false
    })
    .option("pythPriceFeedLabel", {
      alias: ["pyth-price-feed-label", "pyth-feed-label"],
      type: "string",
      description:
        "Localnet artifact feed label to resolve the base feed id when --base-pyth-price-feed-id is omitted.",
      demandOption: false
    })
    .option("orderExpirationTimeMs", {
      alias: ["order-expiration-time-ms"],
      type: "string",
      description: "Order expiration duration in milliseconds (u64).",
      default: DEFAULT_ORDER_EXPIRATION_TIME_MS,
      demandOption: false
    })
    .option("maxPriceAgeSecs", {
      alias: ["max-price-age-secs"],
      type: "string",
      description: "Maximum acceptable Pyth price age in seconds (u64).",
      default: DEFAULT_MAX_PRICE_AGE_SECS,
      demandOption: false
    })
    .option("maxConfRatioBps", {
      alias: ["max-conf-ratio-bps"],
      type: "string",
      description:
        "Maximum acceptable confidence-to-price ratio in basis points (u64).",
      default: DEFAULT_MAX_CONF_RATIO_BPS,
      demandOption: false
    })
    .option("ammPackageId", {
      alias: ["amm-package-id"],
      type: "string",
      description:
        "Package ID for the AMM Move package; inferred from the latest publish entry in deployments/deployment.<network>.json when omitted.",
      demandOption: false
    })
    .option("devInspect", {
      alias: ["dev-inspect", "debug"],
      type: "boolean",
      default: false,
      description: "Run a dev-inspect and log VM error details."
    })
    .option("dryRun", {
      alias: ["dry-run"],
      type: "boolean",
      default: false,
      description: "Run dev-inspect and exit without executing the transaction."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)
