/**
 * Localnet registration: authorizes PropAmm in DeepBook, creates a trader account,
 * and registers the balance manager.
 */
import yargs from "yargs"

import {
  isBalanceManagerMapInitialized,
  isPropAmmAppAuthorizedInRegistry,
  resolveDeepbookAdminCapId,
  resolveDeepbookPackageId,
  resolveDeepbookRegistryId,
  resolvePropAmmAppType
} from "@sui-amm/domain-core/models/deepbook"
import {
  buildAuthorizePropAmmAppTransaction,
  buildInitBalanceManagerMapTransaction
} from "@sui-amm/domain-core/ptb/deepbook"
import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import { assertLocalnetNetwork } from "@sui-amm/tooling-core/network"
import {
  resolveOwnerAddress,
  resolveSignerAddress
} from "@sui-amm/tooling-node/account"
import { readArtifact } from "@sui-amm/tooling-node/artifacts"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { logKeyValueGreen, logWarning } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { resolveAmmAdminCapIdOrClaim } from "../../utils/amm.ts"
import { createTraderAccountAndRegisterBalanceManager } from "../../utils/deepbook-registration.ts"
import { mockArtifactPath, type MockArtifact } from "../../utils/mocks.ts"

type RegisterLocalnetCliArgs = {
  ammPackageId?: string
  adminCapId?: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
  deepbookAdminCapId?: string
  ownerAddress?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

type DeepbookArtifacts = {
  deepbookPackageId: string
  deepbookRegistryId: string
  deepbookAdminCapId: string
}

const resolveDeepbookArtifacts = async (
  cliArguments: RegisterLocalnetCliArgs
): Promise<DeepbookArtifacts> => {
  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})

  const deepbookPackageId =
    cliArguments.deepbookPackageId ?? mockArtifact.deepbookPackageId
  const deepbookRegistryId =
    cliArguments.deepbookRegistryId ?? mockArtifact.deepbookRegistryId
  const deepbookAdminCapId =
    cliArguments.deepbookAdminCapId ?? mockArtifact.deepbookAdminCapId

  return {
    deepbookPackageId: resolveDeepbookPackageId(
      deepbookPackageId,
      "DeepBook package id is required; run mock:setup or pass --deepbook-package-id."
    ),
    deepbookRegistryId: resolveDeepbookRegistryId(
      deepbookRegistryId,
      "DeepBook registry id is required; run mock:setup or pass --deepbook-registry-id."
    ),
    deepbookAdminCapId: resolveDeepbookAdminCapId(
      deepbookAdminCapId,
      "DeepBook admin cap id is required; run mock:setup or pass --deepbook-admin-cap-id."
    )
  }
}

runSuiScript(
  async (tooling, cliArguments: RegisterLocalnetCliArgs) => {
    assertLocalnetNetwork(tooling.network.networkName)

    const signerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)

    await tooling.ensureFoundedAddress({
      signerAddress,
      signer: tooling.loadedEd25519KeyPair
    })

    const ownerAddress = await resolveOwnerAddress(
      cliArguments.ownerAddress,
      tooling.suiConfig.network
    )

    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })
    const ammAdminCapId = await resolveAmmAdminCapIdOrClaim({
      tooling,
      ammPackageId,
      adminCapId: cliArguments.adminCapId
    })
    const deepbookArtifacts = await resolveDeepbookArtifacts(cliArguments)

    const appType = resolvePropAmmAppType(ammPackageId)
    const alreadyAuthorized = await isPropAmmAppAuthorizedInRegistry({
      suiClient: tooling.suiClient,
      deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
      deepbookPackageId: deepbookArtifacts.deepbookPackageId,
      ammPackageId
    })

    let authorizeSummary: { label?: string } | undefined
    if (!alreadyAuthorized) {
      const deepbookRegistry = await tooling.getMutableSharedObject({
        objectId: deepbookArtifacts.deepbookRegistryId
      })
      const authorizeTransaction = buildAuthorizePropAmmAppTransaction({
        deepbookPackageId: deepbookArtifacts.deepbookPackageId,
        deepbookRegistry,
        deepbookAdminCapId: deepbookArtifacts.deepbookAdminCapId,
        appType
      })
      const authorizeResult = await tooling.executeTransactionWithSummary({
        transaction: authorizeTransaction,
        signer: tooling.loadedEd25519KeyPair,
        summaryLabel: "authorize-prop-amm",
        devInspect: cliArguments.devInspect,
        dryRun: cliArguments.dryRun
      })
      authorizeSummary = authorizeResult?.summary
    } else {
      logWarning(
        "PropAmmApp already authorized in DeepBook registry; skipping."
      )
    }

    const balanceManagerMapInitialized = await isBalanceManagerMapInitialized({
      suiClient: tooling.suiClient,
      deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
      deepbookPackageId: deepbookArtifacts.deepbookPackageId
    })

    if (!balanceManagerMapInitialized) {
      const deepbookRegistry = await tooling.getMutableSharedObject({
        objectId: deepbookArtifacts.deepbookRegistryId
      })
      const initTransaction = buildInitBalanceManagerMapTransaction({
        deepbookPackageId: deepbookArtifacts.deepbookPackageId,
        deepbookRegistry,
        deepbookAdminCapId: deepbookArtifacts.deepbookAdminCapId
      })
      await tooling.executeTransactionWithSummary({
        transaction: initTransaction,
        signer: tooling.loadedEd25519KeyPair,
        summaryLabel: "init-balance-manager-map",
        devInspect: cliArguments.devInspect,
        dryRun: cliArguments.dryRun
      })
    }

    const registrationResult =
      await createTraderAccountAndRegisterBalanceManager({
        tooling,
        ammPackageId,
        deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
        ammAdminCapId,
        ownerAddress,
        devInspect: cliArguments.devInspect,
        dryRun: cliArguments.dryRun
      })

    if (!registrationResult)
      throw new Error("Failed to create the trader account.")

    if (
      emitJsonOutput(
        {
          ownerAddress,
          ammPackageId,
          ammAdminCapId,
          deepbookPackageId: deepbookArtifacts.deepbookPackageId,
          deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
          deepbookAdminCapId: deepbookArtifacts.deepbookAdminCapId,
          traderAccountId: registrationResult.traderAccountId,
          balanceManagerId: registrationResult.balanceManagerId,
          transactionSummaries: {
            authorize: authorizeSummary,
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
    logKeyValueGreen("DeepBook package")(deepbookArtifacts.deepbookPackageId)
    logKeyValueGreen("DeepBook registry")(deepbookArtifacts.deepbookRegistryId)
    logKeyValueGreen("Trader account")(registrationResult.traderAccountId)
    logKeyValueGreen("Balance manager")(registrationResult.balanceManagerId)
  },
  yargs()
    .option("ammPackageId", {
      alias: ["amm-package-id"],
      type: "string",
      description:
        "Package ID for the PropAmm Move package; inferred from the latest publish entry when omitted."
    })
    .option("adminCapId", {
      alias: ["admin-cap-id"],
      type: "string",
      description:
        "AMM admin cap id; inferred from owned objects or claimed from the admin cap store when omitted."
    })
    .option("deepbookPackageId", {
      alias: ["deepbook-package-id"],
      type: "string",
      description:
        "DeepBook package id; inferred from mock artifacts when omitted."
    })
    .option("deepbookRegistryId", {
      alias: ["deepbook-registry-id"],
      type: "string",
      description:
        "DeepBook registry id; inferred from mock artifacts when omitted."
    })
    .option("deepbookAdminCapId", {
      alias: ["deepbook-admin-cap-id"],
      type: "string",
      description:
        "DeepBook admin cap id; inferred from mock artifacts when omitted."
    })
    .option("ownerAddress", {
      alias: ["owner-address"],
      type: "string",
      description:
        "Owner address for the trader account; defaults to the active signer."
    })
    .option("devInspect", {
      alias: ["dev-inspect"],
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
