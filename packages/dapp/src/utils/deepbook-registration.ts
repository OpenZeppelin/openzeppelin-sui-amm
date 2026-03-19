import { type TraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import {
  buildCreateTraderAccountTransaction,
  buildRegisterBalanceManagerTransaction
} from "@sui-amm/domain-core/ptb/deepbook"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { ensureCreatedObject } from "@sui-amm/tooling-node/transactions"
import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"
import {
  getOwnedTraderAccountOverview,
  resolveOwnedTraderAccountId
} from "./trader-account.ts"
import { buildSummaryLabel } from "./transaction-summary.ts"

const CREATE_TRADER_ACCOUNT_LABEL = "create-trader-account"

type RegistrationTooling = Pick<
  Tooling,
  | "executeTransactionWithSummary"
  | "getImmutableSharedObject"
  | "getMutableSharedObject"
  | "loadedEd25519KeyPair"
  | "suiClient"
>

export type RegisterBalanceManagerResult = {
  status: "registered" | "dry-run-create-only"
  traderAccount?: TraderAccountOverview
  note?: string
  transactionSummaries: {
    createTraderAccount?: TransactionSummary
    registerBalanceManager?: TransactionSummary
  }
}

const createTraderAccount = async ({
  tooling,
  ammPackageId,
  deepbookRegistryId,
  ownerAddress,
  ammAdminCapId,
  devInspect,
  dryRun
}: {
  tooling: RegistrationTooling
  ammPackageId: string
  deepbookRegistryId: string
  ownerAddress: string
  ammAdminCapId: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<{
  traderAccountId?: string
  summary: TransactionSummary
}> => {
  const deepbookRegistry = await tooling.getImmutableSharedObject({
    objectId: deepbookRegistryId
  })
  const createTransaction = buildCreateTraderAccountTransaction({
    ammPackageId,
    deepbookRegistry,
    ownerAddress,
    ammAdminCapId
  })
  const createResult = await tooling.executeTransactionWithSummary({
    transaction: createTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: CREATE_TRADER_ACCOUNT_LABEL,
    devInspect,
    dryRun
  })

  if (dryRun) {
    return {
      summary:
        createResult.summary ?? buildSummaryLabel(CREATE_TRADER_ACCOUNT_LABEL)
    }
  }

  const createExecution = createResult.execution?.transactionResult
  if (!createExecution)
    throw new Error("Trader account creation did not execute.")

  return {
    traderAccountId: ensureCreatedObject(
      "::executor::TraderAccount",
      createExecution
    ).objectId,
    summary:
      createResult.summary ?? buildSummaryLabel(CREATE_TRADER_ACCOUNT_LABEL)
  }
}

const resolveTraderAccountForRegistration = async ({
  tooling,
  ownerAddress,
  ammPackageId
}: {
  tooling: Pick<Tooling, "suiClient">
  ownerAddress: string
  ammPackageId: string
}) =>
  resolveOwnedTraderAccountId({
    tooling,
    ownerAddress,
    ammPackageId
  })

const maybeCreateTraderAccount = async ({
  tooling,
  resolvedTraderAccountId,
  ammPackageId,
  deepbookRegistryId,
  ownerAddress,
  ammAdminCapId,
  devInspect,
  dryRun
}: {
  tooling: RegistrationTooling
  resolvedTraderAccountId?: string
  ammPackageId: string
  deepbookRegistryId: string
  ownerAddress: string
  ammAdminCapId: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<
  | {
      status: "ready"
      traderAccountId: string
      createTraderAccountSummary?: TransactionSummary
    }
  | {
      status: "dry-run-create-only"
      createTraderAccountSummary: TransactionSummary
      note: string
    }
> => {
  if (resolvedTraderAccountId)
    return {
      status: "ready",
      traderAccountId: resolvedTraderAccountId
    }

  const createResult = await createTraderAccount({
    tooling,
    ammPackageId,
    deepbookRegistryId,
    ownerAddress,
    ammAdminCapId,
    devInspect,
    dryRun
  })

  if (dryRun)
    return {
      status: "dry-run-create-only",
      createTraderAccountSummary: createResult.summary,
      note: "Dry-run created a trader account simulation only. Created object IDs are unavailable without execution, so registration could not be simulated in the same run. Re-run without --dry-run to execute the full create-and-register flow."
    }

  if (!createResult.traderAccountId)
    throw new Error(
      "Trader account creation did not return a trader account id."
    )

  return {
    status: "ready",
    traderAccountId: createResult.traderAccountId,
    createTraderAccountSummary: createResult.summary
  }
}

const registerBalanceManagerForTraderAccount = async ({
  tooling,
  traderAccountId,
  ammPackageId,
  deepbookRegistryId,
  ownerAddress,
  ammAdminCapId,
  summaryLabel,
  devInspect,
  dryRun
}: {
  tooling: RegistrationTooling
  traderAccountId: string
  ammPackageId: string
  deepbookRegistryId: string
  ownerAddress: string
  ammAdminCapId: string
  summaryLabel: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<{
  traderAccount: TraderAccountOverview
  registerBalanceManagerSummary: TransactionSummary
}> => {
  const [traderAccount, deepbookRegistry] = await Promise.all([
    getOwnedTraderAccountOverview({
      tooling,
      traderAccountId,
      ownerAddress,
      ammPackageId,
      operation: "Trader account lookup"
    }),
    tooling.getMutableSharedObject({ objectId: deepbookRegistryId })
  ])

  const registerTransaction = buildRegisterBalanceManagerTransaction({
    ammPackageId,
    traderAccountId: traderAccount.traderAccountId,
    deepbookRegistry,
    ammAdminCapId
  })

  const registerResult = await tooling.executeTransactionWithSummary({
    transaction: registerTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel,
    devInspect,
    dryRun
  })

  return {
    traderAccount,
    registerBalanceManagerSummary:
      registerResult.summary ?? buildSummaryLabel(summaryLabel)
  }
}

export const createTraderAccountAndRegisterBalanceManager = async ({
  tooling,
  ammPackageId,
  deepbookRegistryId,
  ownerAddress,
  ammAdminCapId,
  devInspect,
  dryRun,
  summaryLabel = "register-balance-manager"
}: {
  tooling: RegistrationTooling
  ammPackageId: string
  deepbookRegistryId: string
  ownerAddress: string
  ammAdminCapId: string
  devInspect?: boolean
  dryRun?: boolean
  summaryLabel?: string
}): Promise<RegisterBalanceManagerResult> => {
  const resolvedTraderAccountId = await resolveTraderAccountForRegistration({
    tooling,
    ownerAddress,
    ammPackageId
  })

  const createDecision = await maybeCreateTraderAccount({
    tooling,
    resolvedTraderAccountId,
    ammPackageId,
    deepbookRegistryId,
    ownerAddress,
    ammAdminCapId,
    devInspect,
    dryRun
  })

  if (createDecision.status === "dry-run-create-only") {
    return {
      status: "dry-run-create-only",
      note: createDecision.note,
      transactionSummaries: {
        createTraderAccount: createDecision.createTraderAccountSummary
      }
    }
  }

  const registerDecision = await registerBalanceManagerForTraderAccount({
    tooling,
    traderAccountId: createDecision.traderAccountId,
    ammPackageId,
    deepbookRegistryId,
    ownerAddress,
    ammAdminCapId,
    summaryLabel,
    devInspect,
    dryRun
  })

  return {
    status: "registered",
    traderAccount: registerDecision.traderAccount,
    transactionSummaries: {
      createTraderAccount: createDecision.createTraderAccountSummary,
      registerBalanceManager: registerDecision.registerBalanceManagerSummary
    }
  }
}
