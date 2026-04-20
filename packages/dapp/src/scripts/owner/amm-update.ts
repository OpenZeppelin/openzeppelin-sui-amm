/**
 * Updates an existing shared AMM market maker for the target network.
 */
import yargs from "yargs"

import {
  DEFAULT_MAX_CONF_RATIO_BPS,
  DEFAULT_MAX_PRICE_AGE_SECS,
  DEFAULT_ORDER_EXPIRATION_TIME_MS,
  type AmmConfigOverview,
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildUpdateMarketMakerTransaction } from "@sui-amm/domain-core/ptb/amm"
import {
  resolveAmmConfigId,
  resolveAmmPackageId
} from "@sui-amm/domain-node/amm"
import { normalizeIdOrThrow } from "@sui-amm/tooling-core/object"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import {
  logAmmConfigOverview,
  resolveAmmAdminCapIdFromArtifacts,
  resolvePythPriceFeedIdHex
} from "../../utils/amm.ts"

type UpdateAmmArguments = {
  ammConfigId?: string
  adminCapId?: string
  ammPackageId?: string
  baseSpreadBps?: string
  volatilitySpreadBps?: string
  basePythPriceFeedId?: string
  quotePythPriceFeedId?: string
  pythPriceFeedLabel?: string
  orderExpirationTimeMs?: string
  maxPriceAgeSecs?: string
  maxConfRatioBps?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

type ResolvedAmmUpdateInputs = {
  baseSpreadBps: bigint
  volatilitySpreadBps: bigint
  basePythPriceFeedIdHex: string
  basePythPriceFeedIdBytes: number[]
  quotePythPriceFeedIdHex: string
  quotePythPriceFeedIdBytes: number[]
  orderExpirationTimeMs: bigint
  maxPriceAgeSecs: bigint
  maxConfRatioBps: bigint
}

const resolveExplicitAdminCapId = (adminCapId?: string): string | undefined => {
  const trimmedAdminCapId = adminCapId?.trim()
  if (!trimmedAdminCapId) {
    return undefined
  }

  return normalizeIdOrThrow(
    trimmedAdminCapId,
    "An AMM admin cap id is required; publish the package or provide --admin-cap-id."
  )
}

const resolveAdminCapId = async ({
  tooling,
  cliArguments,
  ammPackageId
}: {
  tooling: Pick<Tooling, "network">
  cliArguments: UpdateAmmArguments
  ammPackageId: string
}): Promise<string> => {
  const explicitAdminCapId = resolveExplicitAdminCapId(cliArguments.adminCapId)
  if (explicitAdminCapId) {
    return explicitAdminCapId
  }

  return resolveAmmAdminCapIdFromArtifacts({
    tooling,
    ammPackageId
  })
}

const shouldResolveNewBasePythPriceFeedId = (
  cliArguments: UpdateAmmArguments
) =>
  Boolean(cliArguments.basePythPriceFeedId?.trim()) ||
  Boolean(cliArguments.pythPriceFeedLabel?.trim())

const resolveBasePythPriceFeedIdHexForUpdate = async ({
  networkName,
  cliArguments,
  currentOverview
}: {
  networkName: string
  cliArguments: UpdateAmmArguments
  currentOverview: AmmConfigOverview
}) => {
  if (!shouldResolveNewBasePythPriceFeedId(cliArguments)) {
    return currentOverview.basePythPriceFeedIdHex
  }

  return resolvePythPriceFeedIdHex({
    networkName,
    pythPriceFeedId: cliArguments.basePythPriceFeedId,
    pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
  })
}

const resolveAmmUpdateInputs = async ({
  networkName,
  cliArguments,
  currentOverview
}: {
  networkName: string
  cliArguments: UpdateAmmArguments
  currentOverview: AmmConfigOverview
}): Promise<ResolvedAmmUpdateInputs> => {
  const basePythPriceFeedIdHex = await resolveBasePythPriceFeedIdHexForUpdate({
    networkName,
    cliArguments,
    currentOverview
  })

  const quotePythPriceFeedIdHex =
    cliArguments.quotePythPriceFeedId?.trim() ||
    currentOverview.quotePythPriceFeedIdHex

  return resolveAmmConfigInputs({
    baseSpreadBps: cliArguments.baseSpreadBps ?? currentOverview.baseSpreadBps,
    volatilitySpreadBps:
      cliArguments.volatilitySpreadBps ?? currentOverview.volatilitySpreadBps,
    basePythPriceFeedIdHex,
    quotePythPriceFeedIdHex,
    orderExpirationTimeMs:
      cliArguments.orderExpirationTimeMs ??
      currentOverview.orderExpirationTimeMs,
    maxPriceAgeSecs:
      cliArguments.maxPriceAgeSecs ?? currentOverview.maxPriceAgeSecs,
    maxConfRatioBps:
      cliArguments.maxConfRatioBps ?? currentOverview.maxConfRatioBps
  })
}

runSuiScript(
  async (tooling, cliArguments: UpdateAmmArguments) => {
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })
    const ammConfigId = await resolveAmmConfigId({
      networkName: tooling.network.networkName,
      ammConfigId: cliArguments.ammConfigId
    })
    const adminCapId = await resolveAdminCapId({
      tooling,
      cliArguments,
      ammPackageId
    })

    const [currentOverview, ammConfigSharedObject] = await Promise.all([
      getAmmConfigOverview(ammConfigId, tooling.suiClient),
      tooling.getMutableSharedObject({ objectId: ammConfigId })
    ])

    const updateInputs = await resolveAmmUpdateInputs({
      networkName: tooling.network.networkName,
      cliArguments,
      currentOverview
    })

    const updateMarketMakerTransaction = buildUpdateMarketMakerTransaction({
      packageId: ammPackageId,
      marketMaker: ammConfigSharedObject,
      adminCapId,
      poolId: currentOverview.poolId,
      baseSpreadBps: updateInputs.baseSpreadBps,
      volatilitySpreadBps: updateInputs.volatilitySpreadBps,
      basePythPriceFeedIdBytes: updateInputs.basePythPriceFeedIdBytes,
      quotePythPriceFeedIdBytes: updateInputs.quotePythPriceFeedIdBytes,
      orderExpirationTimeMs: updateInputs.orderExpirationTimeMs,
      maxPriceAgeSecs: updateInputs.maxPriceAgeSecs,
      maxConfRatioBps: updateInputs.maxConfRatioBps
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: updateMarketMakerTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "update-amm",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) {
      return
    }

    const updatedOverview = await getAmmConfigOverview(
      ammConfigId,
      tooling.suiClient
    )

    if (
      emitJsonOutput(
        {
          ammConfig: updatedOverview,
          ammConfigId,
          adminCapId,
          basePythPriceFeedIdHex: updateInputs.basePythPriceFeedIdHex,
          quotePythPriceFeedIdHex: updateInputs.quotePythPriceFeedIdHex,
          transactionSummary: summary
        },
        cliArguments.json
      )
    ) {
      return
    }

    logAmmConfigOverview(updatedOverview, {
      initialSharedVersion: ammConfigSharedObject.sharedRef.initialSharedVersion
    })
  },
  yargs()
    .option("ammConfigId", {
      alias: ["amm-config-id", "config-id"],
      type: "string",
      description:
        "AMM market maker object id; inferred from the latest objects artifact when omitted.",
      demandOption: false
    })
    .option("adminCapId", {
      alias: ["admin-cap-id"],
      type: "string",
      description:
        "Admin cap object id for AMM updates; inferred from object artifacts when omitted.",
      demandOption: false
    })
    .option("ammPackageId", {
      alias: ["amm-package-id"],
      type: "string",
      description:
        "Package ID for the AMM Move package; inferred from the latest publish entry in deployments/deployment.<network>.json when omitted.",
      demandOption: false
    })
    .option("baseSpreadBps", {
      alias: ["base-spread-bps"],
      type: "string",
      description:
        "Base spread in basis points (u64); defaults to the current config value.",
      demandOption: false
    })
    .option("volatilitySpreadBps", {
      alias: ["volatility-spread-bps"],
      type: "string",
      description:
        "Volatility spread in basis points (u64); defaults to the current config value.",
      demandOption: false
    })
    .option("basePythPriceFeedId", {
      alias: ["base-pyth-price-feed-id", "pyth-price-feed-id", "pyth-feed-id"],
      type: "string",
      description:
        "Base asset Pyth price feed id (32 bytes hex); defaults to the current config value.",
      demandOption: false
    })
    .option("quotePythPriceFeedId", {
      alias: ["quote-pyth-price-feed-id"],
      type: "string",
      description:
        "Quote asset Pyth price feed id (32 bytes hex); defaults to the current config value.",
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
      description:
        "Order expiration duration in milliseconds (u64); defaults to the current config value.",
      default: DEFAULT_ORDER_EXPIRATION_TIME_MS,
      demandOption: false
    })
    .option("maxPriceAgeSecs", {
      alias: ["max-price-age-secs"],
      type: "string",
      description:
        "Maximum acceptable Pyth price age in seconds (u64); defaults to the current config value.",
      default: DEFAULT_MAX_PRICE_AGE_SECS,
      demandOption: false
    })
    .option("maxConfRatioBps", {
      alias: ["max-conf-ratio-bps"],
      type: "string",
      description:
        "Maximum acceptable confidence-to-price ratio in basis points (u64); defaults to the current config value.",
      default: DEFAULT_MAX_CONF_RATIO_BPS,
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
