"use client"

import {
  formatCoinBalance,
  getStructLabel
} from "@sui-amm/tooling-core/utils/formatters"
import { useMemo } from "react"
import {
  useExecutorEventLog,
  type ExecutorEvent
} from "../hooks/useExecutorEventLog"
import useResolvedPackageId from "../hooks/useResolvedPackageId"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import Loading from "./Loading"

// DeepBook prices are scaled by 1e9: rawPrice = quote_atoms * 1e9 / base_atoms.
const PRICE_SCALE = 1_000_000_000n

const findLatestMidRawPrice = (events: ExecutorEvent[]): bigint | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== "QuoteUpdated") continue
    const raw = (event.data as { price?: unknown }).price
    if (typeof raw !== "string" && typeof raw !== "number") continue
    try {
      return BigInt(String(raw))
    } catch {
      continue
    }
  }
  return undefined
}

const baseAtomsToQuote = (atoms: bigint, midRawPrice: bigint): bigint =>
  (atoms * midRawPrice) / PRICE_SCALE

const BalancesCard = () => {
  const { overview, resolution } = useTraderAccountContext()
  const traderAccount = overview.traderAccount
  const packageId = useResolvedPackageId()
  const events = useExecutorEventLog({
    packageId,
    executorId: resolution.traderAccountId,
    limit: 200
  })
  const midRawPrice = useMemo(() => findLatestMidRawPrice(events), [events])

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

    const baseSymbol = getStructLabel(traderAccount.baseCoinType)
    const quoteSymbol = getStructLabel(traderAccount.quoteCoinType)

    const baseBalance = BigInt(traderAccount.baseBalance)
    const quoteBalance = BigInt(traderAccount.quoteBalance)
    const baseInQuote =
      midRawPrice !== undefined
        ? baseAtomsToQuote(baseBalance, midRawPrice)
        : undefined
    const totalQuote =
      baseInQuote !== undefined ? baseInQuote + quoteBalance : undefined

    let baseRatioPct = 0
    let quoteRatioPct = 0
    if (
      totalQuote !== undefined &&
      totalQuote > 0n &&
      baseInQuote !== undefined
    ) {
      // Scale to centi-percent (1e4) before dividing to keep two decimals.
      const baseScaled = (baseInQuote * 10_000n) / totalQuote
      baseRatioPct = Number(baseScaled) / 100
      quoteRatioPct = 100 - baseRatioPct
    }

    const baseAmountDisplay = `${formatCoinBalance({
      balance: traderAccount.baseBalance,
      decimals: traderAccount.baseDecimals
    })} ${baseSymbol}`
    const quoteAmountDisplay = `${formatCoinBalance({
      balance: traderAccount.quoteBalance,
      decimals: traderAccount.quoteDecimals
    })} ${quoteSymbol}`
    const baseInQuoteDisplay =
      baseInQuote !== undefined
        ? `${formatCoinBalance({
            balance: baseInQuote.toString(),
            decimals: traderAccount.quoteDecimals
          })} ${quoteSymbol}`
        : undefined
    const totalQuoteDisplay =
      totalQuote !== undefined
        ? `${formatCoinBalance({
            balance: totalQuote.toString(),
            decimals: traderAccount.quoteDecimals
          })} ${quoteSymbol}`
        : undefined

    const midAvailable = midRawPrice !== undefined

    return (
      <>
        <div className="mb-2 flex items-center justify-between text-[0.7rem]">
          <span className="text-slate-600 dark:text-slate-200/80">
            {baseSymbol}{" "}
            <span className="font-mono font-semibold text-sds-blue">
              {midAvailable ? `${baseRatioPct.toFixed(1)}%` : "—"}
            </span>
          </span>
          <span className="text-slate-600 dark:text-slate-200/80">
            {quoteSymbol}{" "}
            <span className="font-mono font-semibold text-orange-500">
              {midAvailable ? `${quoteRatioPct.toFixed(1)}%` : "—"}
            </span>
          </span>
        </div>
        <div className="flex h-6 overflow-hidden rounded-full border border-slate-200/70 bg-slate-100/80 dark:border-slate-50/15 dark:bg-slate-950/60">
          {midAvailable ? (
            <>
              <div
                className="h-full bg-sds-blue transition-[width] duration-500 ease-out"
                style={{ width: `${baseRatioPct}%` }}
              />
              <div
                className="h-full bg-orange-500 transition-[width] duration-500 ease-out"
                style={{ width: `${quoteRatioPct}%` }}
              />
            </>
          ) : undefined}
        </div>
        <div className="mt-3 flex flex-col gap-1.5 text-[0.7rem]">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-200/70">
              Base (in {baseSymbol})
            </span>
            <span className="font-mono text-sds-dark dark:text-sds-light">
              {baseAmountDisplay}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-200/70">
              Base (in {quoteSymbol})
            </span>
            <span className="font-mono text-sds-dark dark:text-sds-light">
              {baseInQuoteDisplay ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-200/70">
              Quote (in {quoteSymbol})
            </span>
            <span className="font-mono text-sds-dark dark:text-sds-light">
              {quoteAmountDisplay}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-slate-200/70 pt-2 dark:border-slate-50/15">
            <span className="text-slate-500 dark:text-slate-200/70">
              Total (in {quoteSymbol})
            </span>
            <span className="font-mono font-semibold text-sds-dark dark:text-sds-light">
              {totalQuoteDisplay ?? "—"}
            </span>
          </div>
        </div>
        {!midAvailable ? (
          <div className="mt-2 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
            Awaiting QuoteUpdated for mid price.
          </div>
        ) : undefined}
      </>
    )
  }

  return (
    <section className="flex h-full w-full max-w-4xl flex-col px-4 lg:px-0">
      <div className="flex flex-1 flex-col rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-50/30 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
              Balances
            </h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              SUI/USDC balance distribution since last quote refresh
            </p>
          </div>
        </div>
        <div className="px-6 py-5">{renderBody()}</div>
      </div>
    </section>
  )
}

export default BalancesCard
