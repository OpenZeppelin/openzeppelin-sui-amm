"use client"

import {
  formatCoinBalance,
  getStructLabel
} from "@sui-amm/tooling-core/utils/formatters"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import Loading from "./Loading"

const BalanceTile = ({
  label,
  amount,
  symbol,
  sideLabel
}: {
  label: string
  amount: string
  symbol: string
  sideLabel: string
}) => (
  <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
    <div className="flex items-start justify-between gap-2">
      <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/70">
        {label}
      </div>
      <span className="rounded-full bg-sds-blue/10 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-sds-blue">
        {sideLabel}
      </span>
    </div>
    <div className="mt-2 flex items-baseline gap-2 text-sds-dark dark:text-sds-light">
      <span className="font-mono text-2xl font-semibold">{amount}</span>
      <span className="text-sm font-medium text-slate-500 dark:text-slate-200/70">
        {symbol}
      </span>
    </div>
  </div>
)

const BalancesCard = () => {
  const { overview } = useTraderAccountContext()
  const traderAccount = overview.traderAccount

  const renderBody = () => {
    if (overview.status === "loading" || overview.status === "idle") {
      return <Loading />
    }
    if (overview.status === "error") {
      return (
        <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-4 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
          {overview.error ?? "Unable to load balances."}
        </div>
      )
    }
    if (!traderAccount) return null

    return (
      <div className="grid gap-4 md:grid-cols-2">
        <BalanceTile
          label="Base"
          sideLabel={getStructLabel(traderAccount.baseCoinType)}
          symbol={getStructLabel(traderAccount.baseCoinType)}
          amount={formatCoinBalance({
            balance: traderAccount.baseBalance,
            decimals: traderAccount.baseDecimals
          })}
        />
        <BalanceTile
          label="Quote"
          sideLabel={getStructLabel(traderAccount.quoteCoinType)}
          symbol={getStructLabel(traderAccount.quoteCoinType)}
          amount={formatCoinBalance({
            balance: traderAccount.quoteBalance,
            decimals: traderAccount.quoteDecimals
          })}
        />
      </div>
    )
  }

  return (
    <section className="w-full max-w-4xl px-4">
      <div className="rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-50/30 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
              Balances
            </h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              Current BalanceManager holdings (from the Info struct)
            </p>
          </div>
        </div>
        <div className="px-6 py-5">{renderBody()}</div>
      </div>
    </section>
  )
}

export default BalancesCard
