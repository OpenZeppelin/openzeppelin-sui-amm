import { logKeyValueGreen } from "@sui-amm/tooling-node/log"
import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"
import type { RegisterBalanceManagerResult } from "./deepbook-registration.ts"

export const OWNER_SIGNER_MISMATCH_ERROR =
  "Owner address must match the active signer when registering the balance manager."

export const assertOwnerMatchesSigner = ({
  ownerAddress,
  signerAddress
}: {
  ownerAddress: string
  signerAddress: string
}) => {
  if (ownerAddress !== signerAddress) {
    throw new Error(OWNER_SIGNER_MISMATCH_ERROR)
  }
}

export type TransactionSummaryView = Pick<
  TransactionSummary,
  "label" | "digest" | "status" | "error"
>

export const toTransactionSummaryView = (
  summary?: TransactionSummary
): TransactionSummaryView | undefined => {
  if (!summary) return undefined

  return {
    label: summary.label,
    digest: summary.digest,
    status: summary.status,
    error: summary.error
  }
}

export const toRegistrationResultView = (
  registrationResult: RegisterBalanceManagerResult
) => ({
  status: registrationResult.status,
  note: registrationResult.note,
  traderAccount: registrationResult.traderAccount,
  transactionSummaries: {
    createTraderAccount: toTransactionSummaryView(
      registrationResult.transactionSummaries.createTraderAccount
    ),
    registerBalanceManager: toTransactionSummaryView(
      registrationResult.transactionSummaries.registerBalanceManager
    )
  }
})

export const logRegistrationResult = ({
  ownerAddress,
  ammPackageId,
  deepbookPackageId,
  deepbookRegistryId,
  registrationResult
}: {
  ownerAddress: string
  ammPackageId: string
  deepbookPackageId: string
  deepbookRegistryId: string
  registrationResult: RegisterBalanceManagerResult
}) => {
  logKeyValueGreen("Owner")(ownerAddress)
  logKeyValueGreen("AMM package")(ammPackageId)
  logKeyValueGreen("DeepBook package")(deepbookPackageId)
  logKeyValueGreen("DeepBook registry")(deepbookRegistryId)
  logKeyValueGreen("Status")(registrationResult.status)

  if (registrationResult.note) {
    logKeyValueGreen("Note")(registrationResult.note)
  }

  if (registrationResult.traderAccount) {
    logKeyValueGreen("Trader account")(
      registrationResult.traderAccount.traderAccountId
    )
    logKeyValueGreen("Balance manager")(
      registrationResult.traderAccount.balanceManagerId
    )
  }

  logKeyValueGreen("Create summary")(
    registrationResult.transactionSummaries.createTraderAccount?.label ??
      "create-trader-account"
  )
  logKeyValueGreen("Register summary")(
    registrationResult.transactionSummaries.registerBalanceManager?.label ??
      "register-balance-manager"
  )
}
