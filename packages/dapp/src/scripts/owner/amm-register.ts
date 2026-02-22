/**
 * Registers a trader account + balance manager for shared networks (testnet/devnet/mainnet).
 */
import yargs from "yargs"

import {
  isBalanceManagerMapInitialized,
  isPropAmmAppAuthorizedInRegistry,
  resolveDeepbookNetworkIds,
  resolveDeepbookPackageId,
  resolveDeepbookRegistryId
} from "@sui-amm/domain-core/models/deepbook"
import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import {
  resolveOwnerAddress,
  resolveSignerAddress
} from "@sui-amm/tooling-node/account"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { logKeyValueGreen } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { resolveAmmAdminCapIdOrClaim } from "../../utils/amm.ts"
import { createTraderAccountAndRegisterBalanceManager } from "../../utils/deepbook-registration.ts"

type RegisterAmmCliArgs = {
  ammPackageId?: string
  adminCapId?: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
  ownerAddress?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

const buildDeepbookPackageIdErrorMessage = (networkName: string) =>
  `DeepBook package id is required for ${networkName}. Provide --deepbook-package-id.`

const buildDeepbookRegistryIdErrorMessage = (networkName: string) =>
  `DeepBook registry id is required for ${networkName}. Provide --deepbook-registry-id.`

const resolveDeepbookIds = ({
  networkName,
  deepbookPackageId,
  deepbookRegistryId
}: {
  networkName: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
}): { deepbookPackageId: string; deepbookRegistryId: string } => {
  const deepbookNetworkIds = resolveDeepbookNetworkIds(networkName)

  return {
    deepbookPackageId: resolveDeepbookPackageId(
      deepbookPackageId ?? deepbookNetworkIds?.packageId,
      buildDeepbookPackageIdErrorMessage(networkName)
    ),
    deepbookRegistryId: resolveDeepbookRegistryId(
      deepbookRegistryId ?? deepbookNetworkIds?.registryId,
      buildDeepbookRegistryIdErrorMessage(networkName)
    )
  }
}

runSuiScript(
  async (tooling, cliArguments: RegisterAmmCliArgs) => {
    const ownerAddress = await resolveOwnerAddress(
      cliArguments.ownerAddress,
      tooling.suiConfig.network
    )
    const signerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)
    if (ownerAddress !== signerAddress)
      throw new Error(
        "Owner address must match the active signer when registering the balance manager."
      )

    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })
    const ammAdminCapId = await resolveAmmAdminCapIdOrClaim({
      tooling,
      ammPackageId,
      adminCapId: cliArguments.adminCapId,
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    const { deepbookPackageId, deepbookRegistryId } = resolveDeepbookIds({
      networkName: tooling.network.networkName,
      deepbookPackageId: cliArguments.deepbookPackageId,
      deepbookRegistryId: cliArguments.deepbookRegistryId
    })

    const isBalanceManagerMapReady = await isBalanceManagerMapInitialized({
      suiClient: tooling.suiClient,
      deepbookRegistryId,
      deepbookPackageId
    })
    if (!isBalanceManagerMapReady)
      throw new Error(
        "DeepBook registry balance manager map is not initialized. Ask the registry admin to initialize it before registering a balance manager."
      )

    const isAuthorized = await isPropAmmAppAuthorizedInRegistry({
      suiClient: tooling.suiClient,
      deepbookRegistryId,
      deepbookPackageId,
      ammPackageId
    })

    if (!isAuthorized)
      throw new Error(
        "PropAmmApp is not authorized in the DeepBook registry. Request authorization from the registry admin before proceeding."
      )

    const registrationResult =
      await createTraderAccountAndRegisterBalanceManager({
        tooling,
        ammPackageId,
        deepbookRegistryId,
        ammAdminCapId,
        ownerAddress,
        devInspect: cliArguments.devInspect,
        dryRun: cliArguments.dryRun
      })

    if (!registrationResult) return

    if (
      emitJsonOutput(
        {
          ownerAddress,
          ammPackageId,
          ammAdminCapId,
          deepbookPackageId,
          deepbookRegistryId,
          traderAccountId: registrationResult.traderAccountId,
          balanceManagerId: registrationResult.balanceManagerId,
          transactionSummaries: {
            createTraderAccount:
              registrationResult.transactionSummaries.createTraderAccount,
            registerBalanceManager:
              registrationResult.transactionSummaries.registerBalanceManager
          }
        },
        cliArguments.json
      )
    )
      return

    logKeyValueGreen("Owner")(ownerAddress)
    logKeyValueGreen("AMM package")(ammPackageId)
    logKeyValueGreen("AMM admin cap")(ammAdminCapId)
    logKeyValueGreen("DeepBook package")(deepbookPackageId)
    logKeyValueGreen("DeepBook registry")(deepbookRegistryId)
    logKeyValueGreen("Trader account")(registrationResult.traderAccountId)
    logKeyValueGreen("Balance manager")(registrationResult.balanceManagerId)
    logKeyValueGreen("Register summary")(
      registrationResult.transactionSummaries.registerBalanceManager?.label ??
        "register-balance-manager"
    )
  },
  yargs()
    .option("ammPackageId", {
      alias: ["amm-package-id"],
      type: "string",
      description:
        "Package ID for the PropAmm Move package; inferred from the latest publish entry when omitted.",
      demandOption: false
    })
    .option("adminCapId", {
      alias: ["admin-cap-id"],
      type: "string",
      description:
        "AMM admin cap id; inferred from owned objects or claimed from the admin cap store when omitted.",
      demandOption: false
    })
    .option("deepbookPackageId", {
      alias: ["deepbook-package-id"],
      type: "string",
      description:
        "DeepBook package id (defaults to known mainnet/testnet package ids when omitted).",
      demandOption: false
    })
    .option("deepbookRegistryId", {
      alias: ["deepbook-registry-id"],
      type: "string",
      description:
        "DeepBook registry id (defaults to known mainnet/testnet registry ids when omitted).",
      demandOption: false
    })
    .option("ownerAddress", {
      alias: ["owner-address"],
      type: "string",
      description:
        "Owner address for the trader account; defaults to the active signer.",
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
      description: "Run dev-inspect and exit without executing transactions."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)
