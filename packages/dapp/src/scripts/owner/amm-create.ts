/**
 * Creates a new shared AMM config for the target network.
 */
import yargs from "yargs"

import {
  DEFAULT_BASE_SPREAD_BPS,
  DEFAULT_VOLATILITY_MULTIPLIER_BPS,
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildCreateAmmConfigTransaction } from "@sui-amm/domain-core/ptb/amm"
import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { findCreatedArtifactBySuffix } from "@sui-amm/tooling-node/transactions"
import {
  logAmmConfigOverview,
  resolvePythPriceFeedIdHex
} from "../../utils/amm.ts"

type CreateAmmArguments = {
  baseSpreadBps?: string
  volatilityMultiplierBps?: string
  useLaser?: boolean
  pythPriceFeedId?: string
  pythPriceFeedLabel?: string
  ammPackageId?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

runSuiScript(
  async (tooling, cliArguments: CreateAmmArguments) => {
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })

    const ammConfigInputs = await resolveAmmConfigInputs({
      pythPriceFeedIdHex: await resolvePythPriceFeedIdHex({
        networkName: tooling.network.networkName,
        pythPriceFeedId: cliArguments.pythPriceFeedId,
        pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
      }),
      volatilityMultiplierBps: cliArguments.volatilityMultiplierBps,
      baseSpreadBps: cliArguments.baseSpreadBps,
      useLaser: cliArguments.useLaser
    })

    const createAmmTransaction = buildCreateAmmConfigTransaction({
      packageId: ammPackageId,
      baseSpreadBps: ammConfigInputs.baseSpreadBps,
      volatilityMultiplierBps: ammConfigInputs.volatilityMultiplierBps,
      useLaser: ammConfigInputs.useLaser,
      pythPriceFeedIdBytes: ammConfigInputs.pythPriceFeedIdBytes
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: createAmmTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "create-amm",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const createdArtifacts = execution.objectArtifacts.created
    const createdAmmConfig = findCreatedArtifactBySuffix(
      createdArtifacts,
      "::manager::AMMConfig"
    )

    if (!createdAmmConfig)
      throw new Error(
        "Expected an AMM config object to be created, but it was not found in transaction artifacts."
      )

    const ammConfigOverview = await getAmmConfigOverview(
      createdAmmConfig.objectId,
      tooling.suiClient
    )

    if (
      emitJsonOutput(
        {
          ammConfig: ammConfigOverview,
          digest: createdAmmConfig.digest,
          initialSharedVersion: createdAmmConfig.initialSharedVersion,
          pythPriceFeedIdHex: ammConfigInputs.pythPriceFeedIdHex,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logAmmConfigOverview(ammConfigOverview, {
      initialSharedVersion: createdAmmConfig.initialSharedVersion
    })
  },
  yargs()
    .option("baseSpreadBps", {
      alias: ["base-spread-bps"],
      type: "string",
      description: "Base spread in basis points (u64).",
      default: DEFAULT_BASE_SPREAD_BPS,
      demandOption: false
    })
    .option("volatilityMultiplierBps", {
      alias: ["volatility-multiplier-bps"],
      type: "string",
      description: "Volatility multiplier in basis points (u64).",
      default: DEFAULT_VOLATILITY_MULTIPLIER_BPS,
      demandOption: false
    })
    .option("useLaser", {
      alias: ["use-laser"],
      type: "boolean",
      default: false,
      description: "Enable the laser pricing path for the AMM."
    })
    .option("pythPriceFeedId", {
      alias: ["pyth-price-feed-id", "pyth-feed-id"],
      type: "string",
      description: "Pyth price feed id (32 bytes hex).",
      demandOption: false
    })
    .option("pythPriceFeedLabel", {
      alias: ["pyth-price-feed-label", "pyth-feed-label"],
      type: "string",
      description:
        "Localnet mock feed label to resolve the feed id when --pyth-price-feed-id is omitted.",
      demandOption: false
    })
    .option("ammPackageId", {
      alias: ["amm-package-id"],
      type: "string",
      description:
        "Package ID for the PropAmm Move package; inferred from the latest publish entry in deployments/deployment.<network>.json when omitted.",
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
