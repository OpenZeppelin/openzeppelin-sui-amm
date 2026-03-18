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
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getImmutableSharedObject"
    | "loadedEd25519KeyPair"
  >
  ammPackageId: string
  deepbookRegistryId: string
  ownerAddress: string
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
    ownerAddress
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
  traderAccountId,
  ownerAddress,
  ammPackageId
}: {
  tooling: Pick<Tooling, "suiClient">
  traderAccountId?: string
  ownerAddress: string
  ammPackageId: string
}): Promise<string | undefined> =>
  resolveOwnedTraderAccountId({
    tooling,
    traderAccountId,
    ownerAddress,
    ammPackageId
  })

const maybeCreateTraderAccount = async ({
  tooling,
  resolvedTraderAccountId,
  ammPackageId,
  deepbookRegistryId,
  ownerAddress,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getImmutableSharedObject"
    | "loadedEd25519KeyPair"
  >
  resolvedTraderAccountId?: string
  ammPackageId: string
  deepbookRegistryId: string
  ownerAddress: string
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
    devInspect,
    dryRun
  })

  if (dryRun)
    return {
      status: "dry-run-create-only",
      createTraderAccountSummary: createResult.summary,
      note: "Dry-run created a trader account simulation only. Created object IDs are unavailable without execution, so registration could not be simulated in the same run. Re-run without --dry-run or provide --trader-account-id to inspect registration only."
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
  summaryLabel,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getImmutableSharedObject"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
    | "suiClient"
  >
  traderAccountId: string
  ammPackageId: string
  deepbookRegistryId: string
  ownerAddress: string
  summaryLabel: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<{
  traderAccount: TraderAccountOverview
  registerBalanceManagerSummary: TransactionSummary
}> => {
  const traderAccount = await getOwnedTraderAccountOverview({
    tooling,
    traderAccountId,
    ownerAddress,
    ammPackageId,
    operation: "Trader account lookup"
  })

  const [balanceManager, deepbookRegistry] = await Promise.all([
    tooling.getImmutableSharedObject({
      objectId: traderAccount.balanceManagerId
    }),
    tooling.getMutableSharedObject({ objectId: deepbookRegistryId })
  ])

  const registerTransaction = buildRegisterBalanceManagerTransaction({
    ammPackageId,
    traderAccountId: traderAccount.traderAccountId,
    balanceManager,
    deepbookRegistry
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
  traderAccountId,
  devInspect,
  dryRun,
  summaryLabel = "register-balance-manager"
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getImmutableSharedObject"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
    | "suiClient"
  >
  ammPackageId: string
  deepbookRegistryId: string
  ownerAddress: string
  traderAccountId?: string
  devInspect?: boolean
  dryRun?: boolean
  summaryLabel?: string
}): Promise<RegisterBalanceManagerResult> => {
  const resolvedTraderAccountId = await resolveTraderAccountForRegistration({
    tooling,
    traderAccountId,
    ownerAddress,
    ammPackageId
  })

  const createDecision = await maybeCreateTraderAccount({
    tooling,
    resolvedTraderAccountId,
    ammPackageId,
    deepbookRegistryId,
    ownerAddress,
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
