"use client"

import { getStructLabel } from "@sui-amm/tooling-core/utils/formatters"
import Button from "../../components/Button"
import CopyableId from "../../components/CopyableId"
import { useBotControlState } from "../../hooks/useBotControlState"

const StatusBadge = ({ active }: { active: boolean }) => {
  const label = active ? "Active" : "Paused"
  const dotColor = active ? "bg-emerald-500" : "bg-amber-500"
  const textColor = active
    ? "text-emerald-700 dark:text-emerald-200"
    : "text-amber-700 dark:text-amber-200"
  const bgColor = active
    ? "bg-emerald-50/80 border-emerald-200/70 dark:bg-emerald-500/10 dark:border-emerald-500/30"
    : "bg-amber-50/80 border-amber-200/70 dark:bg-amber-500/10 dark:border-amber-500/30"

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${textColor} ${bgColor}`}
    >
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      {label}
    </span>
  )
}

export default function BotPage() {
  const {
    transactionState,
    canPause,
    canUnpause,
    isProcessing,
    pause,
    unpause,
    traderAccount
  } = useBotControlState()

  const active = traderAccount?.active ?? undefined
  const baseSymbol = traderAccount
    ? getStructLabel(traderAccount.baseCoinType)
    : undefined
  const quoteSymbol = traderAccount
    ? getStructLabel(traderAccount.quoteCoinType)
    : undefined

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-sds-dark dark:text-sds-light">
          Bot Status
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-200/70">
          Pause cancels open orders and settles balances. Unpause re-enables
          the next <code className="font-mono text-xs">refresh_quotes</code>{" "}
          call.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-200/60">
              Trading status
            </div>
            {active === undefined ? (
              <span className="text-sm text-slate-500 dark:text-slate-200/70">
                Loading…
              </span>
            ) : (
              <StatusBadge active={active} />
            )}
            {baseSymbol && quoteSymbol ? (
              <div className="text-xs text-slate-500 dark:text-slate-200/70">
                Market{" "}
                <span className="font-mono font-semibold text-sds-dark dark:text-sds-light">
                  {baseSymbol} / {quoteSymbol}
                </span>
              </div>
            ) : undefined}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={pause}
              disabled={!canPause}
              variant={active ? "primary" : "secondary"}
            >
              {isProcessing && transactionState.status === "processing" && transactionState.action === "pause"
                ? "Pausing…"
                : "Pause"}
            </Button>
            <Button
              onClick={unpause}
              disabled={!canUnpause}
              variant={active === false ? "primary" : "secondary"}
            >
              {isProcessing && transactionState.status === "processing" && transactionState.action === "unpause"
                ? "Unpausing…"
                : "Unpause"}
            </Button>
          </div>
        </div>

        {transactionState.status === "error" ? (
          <div className="mt-4 rounded-xl border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-[0.7rem] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <div className="font-semibold">
              {transactionState.action === "pause" ? "Pause" : "Unpause"}{" "}
              failed
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

      {traderAccount ? (
        <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
            On-chain references
          </h2>
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                Executor
              </div>
              <CopyableId
                value={traderAccount.traderAccountId}
                label="Executor"
                className="mt-1 w-full"
              />
            </div>
            <div>
              <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                DeepBook pool
              </div>
              <CopyableId
                value={traderAccount.poolId}
                label="Pool"
                className="mt-1 w-full"
              />
            </div>
            <div>
              <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                BalanceManager
              </div>
              <CopyableId
                value={traderAccount.balanceManagerId}
                label="BM"
                className="mt-1 w-full"
              />
            </div>
          </div>
        </section>
      ) : undefined}

      <div className="rounded-xl border border-slate-200/70 bg-white/60 px-4 py-3 text-[0.7rem] text-slate-600 dark:border-slate-50/15 dark:bg-slate-950/40 dark:text-slate-200/70">
        <div className="font-semibold">Coming soon</div>
        <div className="mt-1">
          Live <code className="font-mono">refresh_quotes</code> diagnostics —
          last quoted mid, conf ratio, and the four most recent order IDs (pulled
          from the <code className="font-mono">QuoteUpdated</code> event feed).
        </div>
      </div>
    </>
  )
}
