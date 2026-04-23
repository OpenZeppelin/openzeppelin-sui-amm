/**
 * Updates the `Market` (pool + Pyth feed ids) of an existing shared AMM market maker for the
 * target network.
 *
 * The on-chain `executor::update_market` call requires the market maker to be paused, so this
 * script emits an atomic PTB: `pause` → `market::new` → `update_market` → `unpause` when the
 * market maker is active (and just `update_market` when already paused).
 */
import { normalizeStructTag, parseStructTag } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  type AmmConfigOverview,
  getAmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import {
  buildUpdateMarketWithPauseTransaction,
  parsePythPriceFeedIdBytes
} from "@sui-amm/domain-core/ptb/amm"
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

type UpdateAmmMarketArguments = {
  ammConfigId?: string
  adminCapId?: string
  ammPackageId?: string
  poolId?: string
  basePythPriceFeedId?: string
  quotePythPriceFeedId?: string
  pythPriceFeedLabel?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
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
  cliArguments: UpdateAmmMarketArguments
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

const resolveNewMarketInputs = async ({
  networkName,
  cliArguments,
  currentOverview
}: {
  networkName: string
  cliArguments: UpdateAmmMarketArguments
  currentOverview: AmmConfigOverview
}): Promise<{
  poolId: string
  basePythPriceFeedIdHex: string
  quotePythPriceFeedIdHex: string
  basePythPriceFeedIdBytes: number[]
  quotePythPriceFeedIdBytes: number[]
}> => {
  const poolId = cliArguments.poolId?.trim()
    ? normalizeIdOrThrow(
        cliArguments.poolId.trim(),
        "Invalid --pool-id provided."
      )
    : currentOverview.poolId

  const shouldResolveNewBase =
    Boolean(cliArguments.basePythPriceFeedId?.trim()) ||
    Boolean(cliArguments.pythPriceFeedLabel?.trim())
  const basePythPriceFeedIdHex = shouldResolveNewBase
    ? await resolvePythPriceFeedIdHex({
        networkName,
        pythPriceFeedId: cliArguments.basePythPriceFeedId,
        pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
      })
    : currentOverview.basePythPriceFeedIdHex

  const quotePythPriceFeedIdHex =
    cliArguments.quotePythPriceFeedId?.trim() ||
    currentOverview.quotePythPriceFeedIdHex

  return {
    poolId,
    basePythPriceFeedIdHex,
    quotePythPriceFeedIdHex,
    basePythPriceFeedIdBytes: parsePythPriceFeedIdBytes(basePythPriceFeedIdHex),
    quotePythPriceFeedIdBytes: parsePythPriceFeedIdBytes(
      quotePythPriceFeedIdHex
    )
  }
}

runSuiScript(
  async (tooling, cliArguments: UpdateAmmMarketArguments) => {
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

    const currentPoolSharedObject = await tooling.getMutableSharedObject({
      objectId: currentOverview.poolId
    })
    const currentPoolType = currentPoolSharedObject.object.type
    if (!currentPoolType) {
      throw new Error(
        `DeepBook pool ${currentOverview.poolId} has no resolvable Move type.`
      )
    }
    const { baseAssetTypeTag, quoteAssetTypeTag } =
      extractPoolAssetTypeTags(currentPoolType)

    const newMarketInputs = await resolveNewMarketInputs({
      networkName: tooling.network.networkName,
      cliArguments,
      currentOverview
    })

    const updateMarketTransaction = buildUpdateMarketWithPauseTransaction({
      packageId: ammPackageId,
      executor: ammConfigSharedObject,
      adminCapId,
      currentActive: currentOverview.active,
      currentPool: currentPoolSharedObject,
      baseAssetTypeTag,
      quoteAssetTypeTag,
      newPoolId: newMarketInputs.poolId,
      basePythPriceFeedIdBytes: newMarketInputs.basePythPriceFeedIdBytes,
      quotePythPriceFeedIdBytes: newMarketInputs.quotePythPriceFeedIdBytes
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: updateMarketTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "update-amm-market",
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
          basePythPriceFeedIdHex: newMarketInputs.basePythPriceFeedIdHex,
          quotePythPriceFeedIdHex: newMarketInputs.quotePythPriceFeedIdHex,
          poolId: newMarketInputs.poolId,
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
    .option("poolId", {
      alias: ["pool-id"],
      type: "string",
      description:
        "DeepBook pool object id for the updated market; defaults to the currently configured pool.",
      demandOption: false
    })
    .option("basePythPriceFeedId", {
      alias: ["base-pyth-price-feed-id", "pyth-price-feed-id", "pyth-feed-id"],
      type: "string",
      description:
        "Base asset Pyth price feed id (32 bytes hex); defaults to the current market value.",
      demandOption: false
    })
    .option("quotePythPriceFeedId", {
      alias: ["quote-pyth-price-feed-id"],
      type: "string",
      description:
        "Quote asset Pyth price feed id (32 bytes hex); defaults to the current market value.",
      demandOption: false
    })
    .option("pythPriceFeedLabel", {
      alias: ["pyth-price-feed-label", "pyth-feed-label"],
      type: "string",
      description:
        "Localnet artifact feed label to resolve the base feed id when --base-pyth-price-feed-id is omitted.",
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
