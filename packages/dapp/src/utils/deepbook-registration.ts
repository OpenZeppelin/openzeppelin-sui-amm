import {
  buildCreateTraderAccountTransaction,
  buildRegisterBalanceManagerTransaction
} from "@sui-amm/domain-core/ptb/deepbook"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { ensureCreatedObject } from "@sui-amm/tooling-node/transactions"

type TransactionSummary = { label?: string }

export type RegisterBalanceManagerResult = {
  traderAccountId: string
  balanceManagerId: string
  transactionSummaries: {
    createTraderAccount?: TransactionSummary
    registerBalanceManager?: TransactionSummary
  }
}

export const createTraderAccountAndRegisterBalanceManager = async ({
  tooling,
  ammPackageId,
  deepbookRegistryId,
  ammAdminCapId,
  ownerAddress,
  devInspect,
  dryRun,
  summaryLabels
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getObjectSafe"
    | "getImmutableSharedObject"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
  >
  ammPackageId: string
  deepbookRegistryId: string
  ammAdminCapId: string
  ownerAddress: string
  devInspect?: boolean
  dryRun?: boolean
  debug?: boolean
  summaryLabels?: {
    createTraderAccount?: string
    registerBalanceManager?: string
  }
}): Promise<RegisterBalanceManagerResult | undefined> => {
  const deepbookRegistry = await tooling.getImmutableSharedObject({
    objectId: deepbookRegistryId
  })

  const createTraderAccountTransaction = buildCreateTraderAccountTransaction({
    ammPackageId,
    deepbookRegistry,
    ammAdminCapId,
    ownerAddress
  })

  const createResult = await tooling.executeTransactionWithSummary({
    transaction: createTraderAccountTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: summaryLabels?.createTraderAccount ?? "create-trader-account",
    devInspect,
    dryRun
  })

  const createExecution = createResult.execution?.transactionResult
  if (!createExecution) return undefined

  const traderAccountId = ensureCreatedObject(
    "::executor::TraderAccount",
    createExecution
  ).objectId
  const balanceManagerId = ensureCreatedObject(
    "::balance_manager::BalanceManager",
    createExecution
  ).objectId

  const balanceManager = await tooling.getImmutableSharedObject({
    objectId: balanceManagerId
  })
  const mutableRegistry = await tooling.getMutableSharedObject({
    objectId: deepbookRegistryId
  })

  const registerTransaction = buildRegisterBalanceManagerTransaction({
    ammPackageId,
    traderAccountId,
    balanceManager,
    deepbookRegistry: mutableRegistry
  })

  const registerResult = await tooling.executeTransactionWithSummary({
    transaction: registerTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel:
      summaryLabels?.registerBalanceManager ?? "register-balance-manager",
    devInspect,
    dryRun
  })

  return {
    traderAccountId,
    balanceManagerId,
    transactionSummaries: {
      createTraderAccount: createResult.summary,
      registerBalanceManager: registerResult.summary
    }
  }
}
