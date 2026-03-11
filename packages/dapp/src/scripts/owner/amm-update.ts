/**
 * Updates an existing shared AMM config for the target network.
 */
import yargs from "yargs"

import {
  type AmmConfigOverview,
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildUpdateAmmConfigTransaction } from "@sui-amm/domain-core/ptb/amm"
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
  volatilityMultiplierBps?: string
  useLaser?: boolean
  tradingPaused?: boolean
  pythPriceFeedId?: string
  pythPriceFeedLabel?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

type ResolvedAmmUpdateInputs = {
  baseSpreadBps: bigint
  volatilityMultiplierBps: bigint
  useLaser: boolean
  tradingPaused: boolean
  pythPriceFeedIdHex: string
  pythPriceFeedIdBytes: number[]
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
  tooling: Pick<Tooling, "network" | "suiClient">
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

const shouldResolveNewPythPriceFeedId = (cliArguments: UpdateAmmArguments) =>
  Boolean(cliArguments.pythPriceFeedId?.trim()) ||
  Boolean(cliArguments.pythPriceFeedLabel?.trim())

const resolvePythPriceFeedIdHexForUpdate = async ({
  networkName,
  cliArguments,
  currentOverview
}: {
  networkName: string
  cliArguments: UpdateAmmArguments
  currentOverview: AmmConfigOverview
}) => {
  if (!shouldResolveNewPythPriceFeedId(cliArguments)) {
    return currentOverview.pythPriceFeedIdHex
  }

  return resolvePythPriceFeedIdHex({
    networkName,
    pythPriceFeedId: cliArguments.pythPriceFeedId,
    pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
  })
}

const resolveTradingPausedForUpdate = ({
  cliArguments,
  currentOverview
}: {
  cliArguments: UpdateAmmArguments
  currentOverview: AmmConfigOverview
}) => cliArguments.tradingPaused ?? currentOverview.tradingPaused

const resolveAmmUpdateInputs = async ({
  networkName,
  cliArguments,
  currentOverview
}: {
  networkName: string
  cliArguments: UpdateAmmArguments
  currentOverview: AmmConfigOverview
}): Promise<ResolvedAmmUpdateInputs> => {
  const pythPriceFeedIdHex = await resolvePythPriceFeedIdHexForUpdate({
    networkName,
    cliArguments,
    currentOverview
  })

  const resolvedAmmConfigInputs = resolveAmmConfigInputs({
    baseSpreadBps: cliArguments.baseSpreadBps ?? currentOverview.baseSpreadBps,
    volatilityMultiplierBps:
      cliArguments.volatilityMultiplierBps ??
      currentOverview.volatilityMultiplierBps,
    useLaser: cliArguments.useLaser ?? currentOverview.useLaser,
    pythPriceFeedIdHex
  })

  return {
    ...resolvedAmmConfigInputs,
    tradingPaused: resolveTradingPausedForUpdate({
      cliArguments,
      currentOverview
    })
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

    const updateInputs = await resolveAmmUpdateInputs({
      networkName: tooling.network.networkName,
      cliArguments,
      currentOverview
    })

    const updateAmmTransaction = buildUpdateAmmConfigTransaction({
      packageId: ammPackageId,
      adminCapId,
      config: ammConfigSharedObject,
      baseSpreadBps: updateInputs.baseSpreadBps,
      volatilityMultiplierBps: updateInputs.volatilityMultiplierBps,
      useLaser: updateInputs.useLaser,
      tradingPaused: updateInputs.tradingPaused,
      pythPriceFeedIdBytes: updateInputs.pythPriceFeedIdBytes
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: updateAmmTransaction,
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
          pythPriceFeedIdHex: updateInputs.pythPriceFeedIdHex,
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
        "AMM config object id; inferred from the latest objects artifact when omitted.",
      demandOption: false
    })
    .option("adminCapId", {
      alias: ["admin-cap-id"],
      type: "string",
      description:
        "Admin cap object id for AMM config updates; inferred from the selected AMM publish when omitted.",
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
    .option("volatilityMultiplierBps", {
      alias: ["volatility-multiplier-bps"],
      type: "string",
      description:
        "Volatility multiplier in basis points (u64); defaults to the current config value.",
      demandOption: false
    })
    .option("useLaser", {
      alias: ["use-laser"],
      type: "boolean",
      description:
        "Enable the laser pricing path for the AMM; defaults to the current config value."
    })
    .option("tradingPaused", {
      alias: ["trading-paused"],
      type: "boolean",
      description:
        "Pause trading for the AMM; defaults to the current config value."
    })
    .option("pythPriceFeedId", {
      alias: ["pyth-price-feed-id", "pyth-feed-id"],
      type: "string",
      description:
        "Pyth price feed id (32 bytes hex); defaults to the current config value.",
      demandOption: false
    })
    .option("pythPriceFeedLabel", {
      alias: ["pyth-price-feed-label", "pyth-feed-label"],
      type: "string",
      description:
        "Localnet artifact feed label to resolve the feed id when --pyth-price-feed-id is omitted.",
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
