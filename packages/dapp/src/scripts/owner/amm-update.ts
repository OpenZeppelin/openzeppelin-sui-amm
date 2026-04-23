/**
 * Updates the configuration of an existing shared AMM market maker for the target network.
 *
 * This script only updates `AMMConfig` (spreads, order expiration, oracle freshness and
 * confidence limits) via `executor::update_config`. Changing the pool or Pyth feeds now lives
 * under `executor::update_market`, which requires the market maker to be paused and is
 * therefore handled by a separate flow.
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
import { buildUpdateConfigTransaction } from "@sui-amm/domain-core/ptb/amm"
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
  resolveAmmAdminCapIdFromArtifacts
} from "../../utils/amm.ts"

type UpdateAmmArguments = {
  ammConfigId?: string
  adminCapId?: string
  ammPackageId?: string
  baseSpreadBps?: string
  volatilitySpreadBps?: string
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

const resolveAmmUpdateInputs = ({
  cliArguments,
  currentOverview
}: {
  cliArguments: UpdateAmmArguments
  currentOverview: AmmConfigOverview
}): ResolvedAmmUpdateInputs => {
  const inputs = resolveAmmConfigInputs({
    baseSpreadBps: cliArguments.baseSpreadBps ?? currentOverview.baseSpreadBps,
    volatilitySpreadBps:
      cliArguments.volatilitySpreadBps ?? currentOverview.volatilitySpreadBps,
    basePythPriceFeedIdHex: currentOverview.basePythPriceFeedIdHex,
    quotePythPriceFeedIdHex: currentOverview.quotePythPriceFeedIdHex,
    orderExpirationTimeMs:
      cliArguments.orderExpirationTimeMs ??
      currentOverview.orderExpirationTimeMs,
    maxPriceAgeSecs:
      cliArguments.maxPriceAgeSecs ?? currentOverview.maxPriceAgeSecs,
    maxConfRatioBps:
      cliArguments.maxConfRatioBps ?? currentOverview.maxConfRatioBps
  })

  return {
    baseSpreadBps: inputs.baseSpreadBps,
    volatilitySpreadBps: inputs.volatilitySpreadBps,
    orderExpirationTimeMs: inputs.orderExpirationTimeMs,
    maxPriceAgeSecs: inputs.maxPriceAgeSecs,
    maxConfRatioBps: inputs.maxConfRatioBps
  }
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

    const updateInputs = resolveAmmUpdateInputs({
      cliArguments,
      currentOverview
    })

    const updateConfigTransaction = buildUpdateConfigTransaction({
      packageId: ammPackageId,
      marketMaker: ammConfigSharedObject,
      adminCapId,
      baseSpreadBps: updateInputs.baseSpreadBps,
      volatilitySpreadBps: updateInputs.volatilitySpreadBps,
      orderExpirationTimeMs: updateInputs.orderExpirationTimeMs,
      maxPriceAgeSecs: updateInputs.maxPriceAgeSecs,
      maxConfRatioBps: updateInputs.maxConfRatioBps
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: updateConfigTransaction,
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
