/**
 * Localnet registration: authorizes PropAmm in DeepBook, initializes the balance manager map,
 * creates a trader account, and registers its balance manager.
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
import { resolveSignerAddress } from "@sui-amm/tooling-node/account"
import { readArtifact } from "@sui-amm/tooling-node/artifacts"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { logWarning } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"
import { resolveAmmAdminCapIdForSigner } from "../../utils/amm.ts"
import {
  logRegistrationResult,
  toRegistrationResultView
} from "../../utils/deepbook-registration-script.ts"
import { createTraderAccountAndRegisterBalanceManager } from "../../utils/deepbook-registration.ts"
import { mockArtifactPath, type MockArtifact } from "../../utils/mocks.ts"
import {
  withAmmPackageIdOption,
  withCommonRegistrationOptions
} from "../../utils/register-script-options.ts"
import { toTransactionSummaryView } from "../../utils/transaction-summary.ts"

type RegisterLocalnetCliArgs = {
  ammPackageId?: string
  ammAdminCapId?: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
  deepbookAdminCapId?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

type DeepbookArtifacts = {
  deepbookPackageId: string
  deepbookRegistryId: string
  deepbookAdminCapId: string
}

const executeSummaryTransaction = async ({
  tooling,
  transaction,
  summaryLabel,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    "executeTransactionWithSummary" | "loadedEd25519KeyPair"
  >
  transaction: Parameters<
    Tooling["executeTransactionWithSummary"]
  >[0]["transaction"]
  summaryLabel: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<TransactionSummary | undefined> => {
  const result = await tooling.executeTransactionWithSummary({
    transaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel,
    devInspect,
    dryRun
  })

  return result.summary
}

const ensureLocalnetDeepbookReady = async ({
  tooling,
  deepbookArtifacts,
  ammPackageId,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
    | "suiClient"
  >
  deepbookArtifacts: DeepbookArtifacts
  ammPackageId: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<{
  authorizeSummary?: TransactionSummary
  initSummary?: TransactionSummary
}> => {
  const appType = resolvePropAmmAppType(ammPackageId)
  const alreadyAuthorized = await isPropAmmAppAuthorizedInRegistry({
    suiClient: tooling.suiClient,
    deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
    deepbookPackageId: deepbookArtifacts.deepbookPackageId,
    ammPackageId
  })

  let authorizeSummary: TransactionSummary | undefined
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
    authorizeSummary = await executeSummaryTransaction({
      tooling,
      transaction: authorizeTransaction,
      summaryLabel: "authorize-prop-amm",
      devInspect,
      dryRun
    })
  } else {
    logWarning("PropAmmApp already authorized in DeepBook registry; skipping.")
  }

  const balanceManagerMapInitialized = await isBalanceManagerMapInitialized({
    suiClient: tooling.suiClient,
    deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
    deepbookPackageId: deepbookArtifacts.deepbookPackageId
  })

  let initSummary: TransactionSummary | undefined
  if (!balanceManagerMapInitialized) {
    const deepbookRegistry = await tooling.getMutableSharedObject({
      objectId: deepbookArtifacts.deepbookRegistryId
    })
    const initTransaction = buildInitBalanceManagerMapTransaction({
      deepbookPackageId: deepbookArtifacts.deepbookPackageId,
      deepbookRegistry,
      deepbookAdminCapId: deepbookArtifacts.deepbookAdminCapId
    })
    initSummary = await executeSummaryTransaction({
      tooling,
      transaction: initTransaction,
      summaryLabel: "init-balance-manager-map",
      devInspect,
      dryRun
    })
  }

  return {
    authorizeSummary,
    initSummary
  }
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

    const ownerAddress = signerAddress

    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })
    const ammAdminCapId = await resolveAmmAdminCapIdForSigner({
      tooling,
      ammPackageId,
      signerAddress,
      ammAdminCapId: cliArguments.ammAdminCapId
    })
    const deepbookArtifacts = await resolveDeepbookArtifacts(cliArguments)

    const { authorizeSummary, initSummary } = await ensureLocalnetDeepbookReady(
      {
        tooling,
        deepbookArtifacts,
        ammPackageId,
        devInspect: cliArguments.devInspect,
        dryRun: cliArguments.dryRun
      }
    )

    const registrationResult =
      await createTraderAccountAndRegisterBalanceManager({
        tooling,
        ammPackageId,
        deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
        ownerAddress,
        ammAdminCapId,
        devInspect: cliArguments.devInspect,
        dryRun: cliArguments.dryRun
      })

    const registrationResultView = toRegistrationResultView(registrationResult)

    if (
      emitJsonOutput(
        {
          ownerAddress,
          ammPackageId,
          ammAdminCapId,
          deepbookPackageId: deepbookArtifacts.deepbookPackageId,
          deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
          deepbookAdminCapId: deepbookArtifacts.deepbookAdminCapId,
          ...registrationResultView,
          transactionSummaries: {
            authorize: toTransactionSummaryView(authorizeSummary),
            initBalanceManagerMap: toTransactionSummaryView(initSummary),
            ...registrationResultView.transactionSummaries
          }
        },
        cliArguments.json
      )
    )
      return

    logRegistrationResult({
      ownerAddress,
      ammPackageId,
      deepbookPackageId: deepbookArtifacts.deepbookPackageId,
      deepbookRegistryId: deepbookArtifacts.deepbookRegistryId,
      registrationResult
    })
  },
  withCommonRegistrationOptions(withAmmPackageIdOption(yargs()))
    .option("ammAdminCapId", {
      alias: ["amm-admin-cap-id", "admin-cap-id"],
      type: "string",
      description:
        "AMM admin cap id; defaults to the signer-owned admin cap for the selected package when omitted."
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
    .strict()
)
