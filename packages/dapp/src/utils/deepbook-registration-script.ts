import { logKeyValueGreen } from "@sui-amm/tooling-node/log"
import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"
import type { ResolveOrCreateTraderAccountResult } from "./deepbook-registration.ts"

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

export const toTraderAccountResultView = (
  traderAccountResult: ResolveOrCreateTraderAccountResult
) => ({
  status: traderAccountResult.status,
  note: traderAccountResult.note,
  traderAccount: traderAccountResult.traderAccount,
  transactionSummaries: {
    createTraderAccount: toTransactionSummaryView(
      traderAccountResult.transactionSummaries.createTraderAccount
    )
  }
})

export const logTraderAccountResult = ({
  ownerAddress,
  ammPackageId,
  adminCapId,
  deepbookPackageId,
  deepbookRegistryId,
  traderAccountResult
}: {
  ownerAddress: string
  ammPackageId: string
  adminCapId?: string
  deepbookPackageId: string
  deepbookRegistryId: string
  traderAccountResult: ResolveOrCreateTraderAccountResult
}) => {
  logKeyValueGreen("Owner")(ownerAddress)
  logKeyValueGreen("AMM package")(ammPackageId)
  if (adminCapId) {
    logKeyValueGreen("AMM admin cap")(adminCapId)
  }
  logKeyValueGreen("DeepBook package")(deepbookPackageId)
  logKeyValueGreen("DeepBook registry")(deepbookRegistryId)
  logKeyValueGreen("Status")(traderAccountResult.status)

  if (traderAccountResult.note) {
    logKeyValueGreen("Note")(traderAccountResult.note)
  }

  if (traderAccountResult.traderAccount) {
    logKeyValueGreen("Trader account")(
      traderAccountResult.traderAccount.traderAccountId
    )
    logKeyValueGreen("Balance manager")(
      traderAccountResult.traderAccount.balanceManagerId
    )
  }

  if (traderAccountResult.transactionSummaries.createTraderAccount) {
    logKeyValueGreen("Create summary")(
      traderAccountResult.transactionSummaries.createTraderAccount.label
    )
  }
}
