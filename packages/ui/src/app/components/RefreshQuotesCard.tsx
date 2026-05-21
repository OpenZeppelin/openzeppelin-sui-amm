"use client"

import { useRefreshQuotesState } from "../hooks/useRefreshQuotesState"
import Button from "./Button"

const RefreshQuotesCard = () => {
  const {
    transactionState,
    canSubmit,
    disabledReason,
    isProcessing,
    handleSubmit
  } = useRefreshQuotesState()

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
            Refresh quotes
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-200/70">
            Manually trigger{" "}
            <code className="font-mono">
              executor::refresh_quotes_permissionless
            </code>
            . The PTB stamps mock Pyth feeds with the current clock timestamp
            and re-places the four orders around the oracle mid.
          </p>
          {disabledReason ? (
            <div className="text-[0.7rem] text-amber-700 dark:text-amber-200">
              {disabledReason}
            </div>
          ) : undefined}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isProcessing ? "Refreshing…" : "Refresh quotes"}
          </Button>
        </div>
      </div>

      {transactionState.status === "error" ? (
        <div className="mt-4 rounded-xl border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-[0.7rem] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <div className="font-semibold">
            refresh_quotes_permissionless failed
          </div>
          <div className="mt-1">{transactionState.error}</div>
          {transactionState.details ? (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold">
                Raw error JSON
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded border border-rose-200/60 bg-white/80 p-2 text-[0.6rem] dark:border-rose-500/30 dark:bg-slate-950/60">
                {transactionState.details}
              </pre>
            </details>
          ) : undefined}
        </div>
      ) : undefined}
    </section>
  )
}

export default RefreshQuotesCard
