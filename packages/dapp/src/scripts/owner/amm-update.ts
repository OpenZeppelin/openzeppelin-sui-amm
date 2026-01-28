/**
 * Updates an existing shared AMM config for the target network.
 */
import yargs from "yargs"

import {
  AMM_ADMIN_CAP_TYPE_SUFFIX,
  type AmmConfigOverview,
  getAmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import {
  buildClaimAmmAdminCapTransaction,
  buildUpdateAmmConfigTransaction,
  parsePythPriceFeedIdBytes
} from "@sui-amm/domain-core/ptb/amm"
import {
  resolveAmmAdminCapId,
  resolveAmmConfigId,
  resolveAmmPackageId
} from "@sui-amm/domain-node/amm"
import {
  parseNonNegativeU64,
  parsePositiveU64
} from "@sui-amm/tooling-core/utils/utility"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import {
  logAmmConfigOverview,
  resolveAmmAdminCapStoreId,
  resolvePythPriceFeedIdHex
} from "../../utils/amm.ts"

type UpdateAmmArguments = {
  baseSpreadBps?: string
  volatilityMultiplierBps?: string
  useLaser?: boolean
  tradingPaused?: boolean
  pythPriceFeedId?: string
  pythPriceFeedLabel?: string
  ammPackageId?: string
  ammConfigId?: string
  adminCapId?: string
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

const resolveSignerAddress = (
  tooling: Pick<Tooling, "loadedEd25519KeyPair">
) => tooling.loadedEd25519KeyPair.toSuiAddress()

const resolveOwnedAmmAdminCapId = async ({
  tooling,
  ammPackageId
}: {
  tooling: Pick<Tooling, "getAllOwnedObjectsByFilter" | "loadedEd25519KeyPair">
  ammPackageId: string
}): Promise<string | undefined> => {
  const ownerAddress = resolveSignerAddress(tooling)
  const adminCaps = await tooling.getAllOwnedObjectsByFilter({
    ownerAddress,
    filter: {
      StructType: `${ammPackageId}${AMM_ADMIN_CAP_TYPE_SUFFIX}`
    }
  })

  return adminCaps[0]?.objectId
}

const resolveAmmAdminCapIdFromCli = async ({
  networkName,
  adminCapId
}: {
  networkName: string
  adminCapId?: string
}): Promise<string | undefined> => {
  const trimmedAdminCapId = adminCapId?.trim()
  if (!trimmedAdminCapId) return undefined

  return resolveAmmAdminCapId({
    networkName,
    adminCapId: trimmedAdminCapId
  })
}

const claimAmmAdminCapFromStore = async ({
  tooling,
  ammPackageId,
  adminCapStoreId,
  devInspect
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
  >
  ammPackageId: string
  adminCapStoreId: string
  devInspect?: boolean
}): Promise<void> => {
  const adminCapStore = await tooling.getMutableSharedObject({
    objectId: adminCapStoreId
  })
  const claimTransaction = buildClaimAmmAdminCapTransaction({
    packageId: ammPackageId,
    adminCapStore
  })

  await tooling.executeTransactionWithSummary({
    transaction: claimTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: "claim-admin-cap",
    devInspect
  })
}

const resolveAmmAdminCapIdOrClaim = async ({
  tooling,
  cliArguments,
  ammPackageId
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getAllOwnedObjectsByFilter"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
    | "network"
    | "suiClient"
  >
  cliArguments: UpdateAmmArguments
  ammPackageId: string
}): Promise<string> => {
  const adminCapIdFromCli = await resolveAmmAdminCapIdFromCli({
    networkName: tooling.network.networkName,
    adminCapId: cliArguments.adminCapId
  })
  if (adminCapIdFromCli) return adminCapIdFromCli

  const ownedAdminCapId = await resolveOwnedAmmAdminCapId({
    tooling,
    ammPackageId
  })
  if (ownedAdminCapId) return ownedAdminCapId

  if (cliArguments.dryRun)
    throw new Error(
      "AMM admin cap id is required in --dry-run mode. Provide --admin-cap-id or run without --dry-run to claim from the admin cap store."
    )

  const adminCapStoreId = await resolveAmmAdminCapStoreId({
    tooling,
    ammPackageId
  })
  await claimAmmAdminCapFromStore({
    tooling,
    ammPackageId,
    adminCapStoreId,
    devInspect: cliArguments.devInspect
  })

  const claimedAdminCapId = await resolveOwnedAmmAdminCapId({
    tooling,
    ammPackageId
  })
  if (!claimedAdminCapId)
    throw new Error(
      "Unable to resolve the AMM admin cap after claiming. Provide --admin-cap-id and retry."
    )

  return claimedAdminCapId
}

const resolveBaseSpreadBps = (rawValue: string): bigint =>
  parsePositiveU64(rawValue, "Base spread bps")

const resolveVolatilityMultiplierBps = (rawValue: string): bigint =>
  parseNonNegativeU64(rawValue, "Volatility multiplier bps")

const resolveAmmUpdateInputs = async ({
  networkName,
  cliArguments,
  currentOverview
}: {
  networkName: string
  cliArguments: UpdateAmmArguments
  currentOverview: AmmConfigOverview
}): Promise<ResolvedAmmUpdateInputs> => {
  const baseSpreadBps = resolveBaseSpreadBps(
    cliArguments.baseSpreadBps ?? currentOverview.baseSpreadBps
  )
  const volatilityMultiplierBps = resolveVolatilityMultiplierBps(
    cliArguments.volatilityMultiplierBps ??
      currentOverview.volatilityMultiplierBps
  )

  const useLaser = cliArguments.useLaser ?? currentOverview.useLaser
  const tradingPaused =
    cliArguments.tradingPaused ?? currentOverview.tradingPaused

  const shouldResolveFeedFromCli =
    Boolean(cliArguments.pythPriceFeedId?.trim()) ||
    Boolean(cliArguments.pythPriceFeedLabel?.trim())

  const pythPriceFeedIdHex = shouldResolveFeedFromCli
    ? await resolvePythPriceFeedIdHex({
        networkName,
        pythPriceFeedId: cliArguments.pythPriceFeedId,
        pythPriceFeedLabel: cliArguments.pythPriceFeedLabel
      })
    : currentOverview.pythPriceFeedIdHex

  return {
    baseSpreadBps,
    volatilityMultiplierBps,
    useLaser,
    tradingPaused,
    pythPriceFeedIdHex,
    pythPriceFeedIdBytes: parsePythPriceFeedIdBytes(pythPriceFeedIdHex)
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
    const adminCapId = await resolveAmmAdminCapIdOrClaim({
      tooling,
      cliArguments,
      ammPackageId
    })

    const ammConfigSharedObject = await tooling.getMutableSharedObject({
      objectId: ammConfigId
    })
    const currentOverview = await getAmmConfigOverview(
      ammConfigId,
      tooling.suiClient
    )

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

    if (!execution) return

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
    )
      return

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
        "AMM admin cap id; inferred from owned objects or claimed from the admin cap store when omitted.",
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
        "Localnet mock feed label used when resolving a new feed id.",
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
