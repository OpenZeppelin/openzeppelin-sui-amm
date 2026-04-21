import { logKeyValueGreen } from "@sui-amm/tooling-node/log"
import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"
import type { ResolveTraderAccountResult } from "./deepbook-registration.ts"

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
  traderAccountResult: ResolveTraderAccountResult
) => ({
  traderAccount: traderAccountResult.traderAccount
})

export const logTraderAccountResult = ({
  ownerAddress,
  ammPackageId,
  deepbookPackageId,
  deepbookRegistryId,
  traderAccountResult
}: {
  ownerAddress: string
  ammPackageId: string
  deepbookPackageId: string
  deepbookRegistryId: string
  traderAccountResult: ResolveTraderAccountResult
}) => {
  logKeyValueGreen("Owner")(ownerAddress)
  logKeyValueGreen("AMM package")(ammPackageId)
  logKeyValueGreen("DeepBook package")(deepbookPackageId)
  logKeyValueGreen("DeepBook registry")(deepbookRegistryId)
  logKeyValueGreen("Market maker")(
    traderAccountResult.traderAccount.traderAccountId
  )
  logKeyValueGreen("Balance manager")(
    traderAccountResult.traderAccount.balanceManagerId
  )
}
