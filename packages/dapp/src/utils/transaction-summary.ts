import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"

export type TransactionSummaryView = Pick<
  TransactionSummary,
  "label" | "digest" | "status" | "error"
>

export const buildSummaryLabel = (label: string): TransactionSummary => ({
  label,
  objectChanges: [],
  balanceChanges: []
})

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
