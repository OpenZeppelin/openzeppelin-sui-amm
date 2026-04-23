/**
 * Creates a new shared AMM market maker executor for the target network.
 */
import { normalizeStructTag, parseStructTag } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  DEFAULT_BASE_SPREAD_BPS,
  DEFAULT_MAX_CONF_RATIO_BPS,
  DEFAULT_MAX_PRICE_AGE_SECS,
  DEFAULT_ORDER_EXPIRATION_TIME_MS,
  DEFAULT_OUTER_BALANCE_BPS,
  DEFAULT_VOLATILITY_SPREAD_BPS,
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { EXECUTOR_TYPE_SUFFIX } from "@sui-amm/domain-core/models/traderAccount"
import { buildCreateExecutorTransaction } from "@sui-amm/domain-core/ptb/amm"
import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import { deriveCurrencyObjectId } from "@sui-amm/tooling-core/coin-registry"
import { SUI_COIN_REGISTRY_ID } from "@sui-amm/tooling-core/constants"
import { normalizeIdOrThrow } from "@sui-amm/tooling-core/object"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { findCreatedArtifactBySuffix } from "@sui-amm/tooling-node/transactions"
import {
  logAmmConfigOverview,
  resolvePythPriceFeedIdHex
} from "../../utils/amm.ts"

type CreateAmmArguments = {
  poolId?: string
  baseCurrencyId?: string
  quoteCurrencyId?: string
  baseSpreadBps?: string
  volatilitySpreadBps?: string
  basePythPriceFeedId?: string
  quotePythPriceFeedId?: string
  pythPriceFeedLabel?: string
  orderExpirationTimeMs?: string
  maxPriceAgeSecs?: string
  maxConfRatioBps?: string
  outerBalanceBps?: string
  ammPackageId?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

const extractPoolAssetTypeTags = (
  poolType: string
): { baseAssetTypeTag: string; quoteAssetTypeTag: string } => {
  const structTag = parseStructTag(poolType)
  if (structTag.typeParams.length !== 2) {
    throw new Error(
      `Expected DeepBook pool type to have two type params, got ${poolType}.`
    )
  }

  return {
    baseAssetTypeTag: normalizeStructTag(structTag.typeParams[0]),
    quoteAssetTypeTag: normalizeStructTag(structTag.typeParams[1])
  }
}

runSuiScript(
  async (tooling: Tooling, cliArguments: CreateAmmArguments) => {
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })

    const trimmedPoolId = cliArguments.poolId?.trim()
    if (!trimmedPoolId) {
      throw new Error("--pool-id is required.")
    }
    const poolId = normalizeIdOrThrow(
      trimmedPoolId,
      "Invalid --pool-id provided."
    )

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
      maxConfRatioBps: cliArguments.maxConfRatioBps,
      outerBalanceBps: cliArguments.outerBalanceBps
    })

    const pool = await tooling.getImmutableSharedObject({ objectId: poolId })
    const poolType = pool.object.type
    if (!poolType) {
      throw new Error(`DeepBook pool ${poolId} has no resolvable Move type.`)
    }
    const { baseAssetTypeTag, quoteAssetTypeTag } =
      extractPoolAssetTypeTags(poolType)

    const baseCurrencyId = cliArguments.baseCurrencyId?.trim()
      ? normalizeIdOrThrow(
          cliArguments.baseCurrencyId.trim(),
          "Invalid --base-currency-id provided."
        )
      : deriveCurrencyObjectId(baseAssetTypeTag, SUI_COIN_REGISTRY_ID)
    const quoteCurrencyId = cliArguments.quoteCurrencyId?.trim()
      ? normalizeIdOrThrow(
          cliArguments.quoteCurrencyId.trim(),
          "Invalid --quote-currency-id provided."
        )
      : deriveCurrencyObjectId(quoteAssetTypeTag, SUI_COIN_REGISTRY_ID)

    const [baseCurrency, quoteCurrency] = await Promise.all([
      tooling.getImmutableSharedObject({ objectId: baseCurrencyId }),
      tooling.getImmutableSharedObject({ objectId: quoteCurrencyId })
    ])

    const senderAddress = tooling.loadedEd25519KeyPair.toSuiAddress()

    const createExecutorTransaction = buildCreateExecutorTransaction({
      packageId: ammPackageId,
      pool,
      baseCurrency,
      quoteCurrency,
      baseAssetTypeTag,
      quoteAssetTypeTag,
      senderAddress,
      baseSpreadBps: ammConfigInputs.baseSpreadBps,
      volatilitySpreadBps: ammConfigInputs.volatilitySpreadBps,
      basePythPriceFeedIdBytes: ammConfigInputs.basePythPriceFeedIdBytes,
      quotePythPriceFeedIdBytes: ammConfigInputs.quotePythPriceFeedIdBytes,
      orderExpirationTimeMs: ammConfigInputs.orderExpirationTimeMs,
      maxPriceAgeSecs: ammConfigInputs.maxPriceAgeSecs,
      maxConfRatioBps: ammConfigInputs.maxConfRatioBps,
      outerBalanceBps: ammConfigInputs.outerBalanceBps
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: createExecutorTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "create-amm",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) {
      return
    }

    const createdArtifacts = execution.objectArtifacts.created
    const createdExecutor = findCreatedArtifactBySuffix(
      createdArtifacts,
      EXECUTOR_TYPE_SUFFIX
    )
    const createdAdminCap = findCreatedArtifactBySuffix(
      createdArtifacts,
      AMM_ADMIN_CAP_TYPE_SUFFIX
    )

    if (!createdExecutor) {
      throw new Error(
        "Expected an Executor object to be created, but it was not found in transaction artifacts."
      )
    }
    if (!createdAdminCap) {
      throw new Error(
        "Expected an AdminCap object to be created, but it was not found in transaction artifacts."
      )
    }

    const ammConfigOverview = await getAmmConfigOverview(
      createdExecutor.objectId,
      tooling.suiClient
    )

    if (
      emitJsonOutput(
        {
          ammConfig: ammConfigOverview,
          adminCapId: createdAdminCap.objectId,
          digest: createdExecutor.digest,
          initialSharedVersion: createdExecutor.initialSharedVersion,
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
      initialSharedVersion: createdExecutor.initialSharedVersion
    })
  },
  yargs()
    .option("poolId", {
      alias: ["pool-id"],
      type: "string",
      description: "DeepBook pool object id for the market maker executor.",
      demandOption: false
    })
    .option("baseCurrencyId", {
      alias: ["base-currency-id"],
      type: "string",
      description:
        "Object id of the base asset `Currency<BaseAsset>`; derived from the pool base asset type when omitted.",
      demandOption: false
    })
    .option("quoteCurrencyId", {
      alias: ["quote-currency-id"],
      type: "string",
      description:
        "Object id of the quote asset `Currency<QuoteAsset>`; derived from the pool quote asset type when omitted.",
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
    .option("outerBalanceBps", {
      alias: ["outer-balance-bps"],
      type: "string",
      description:
        "Share of the settleable balance allocated to the outer (volatility) spread order in basis points (u64).",
      default: DEFAULT_OUTER_BALANCE_BPS,
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
