"use client"

import { formatCoinBalance } from "@sui-amm/tooling-core/utils/formatters"
import {
  useExecutorEventLog,
  type ExecutorEvent,
  type ExecutorEventType
} from "../hooks/useExecutorEventLog"
import useResolvedPackageId from "../hooks/useResolvedPackageId"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"

const TYPE_TONE: Record<ExecutorEventType, string> = {
  ExecutorCreated:
    "bg-sds-blue/10 text-sds-blue border-sds-blue/30 dark:bg-sds-blue/20 dark:border-sds-blue/40",
  QuoteUpdated:
    "bg-sds-blue/10 text-sds-blue border-sds-blue/30 dark:bg-sds-blue/20 dark:border-sds-blue/40",
  ExecutorPaused:
    "bg-amber-100/80 text-amber-700 border-amber-200/70 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30",
  ExecutorUnpaused:
    "bg-emerald-100/80 text-emerald-700 border-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30",
  ExecutorConfigUpdated:
    "bg-slate-100/80 text-slate-700 border-slate-200/70 dark:bg-slate-50/10 dark:text-slate-200 dark:border-slate-50/15",
  Deposited:
    "bg-emerald-100/80 text-emerald-700 border-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30",
  Withdrawn:
    "bg-rose-100/80 text-rose-700 border-rose-200/70 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-500/30"
}

const formatTimestamp = (timestampMs: number | null) => {
  if (!timestampMs) return "—"
  const date = new Date(timestampMs)
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
}

const formatDeepbookPrice = (
  rawPrice: string | undefined,
  baseDecimals: number,
  quoteDecimals: number
) => {
  if (!rawPrice) return "—"
  // DeepBook price is fixed-point (1e9) and decimal-adjusted for the pair:
  // human_price = raw / 1e9 * 10^(base_decimals - quote_decimals)
  const decimalShift = baseDecimals - quoteDecimals
  const adjustedDecimals = 9 - decimalShift
  if (adjustedDecimals < 0) {
    return `${rawPrice} (raw)`
  }
  return formatCoinBalance({
    balance: rawPrice,
    decimals: adjustedDecimals,
    maxFractionDigits: 6
  })
}

const orderIdSummary = (data: Record<string, unknown>) => {
  const orders = Array.isArray(data.orders) ? data.orders : []
  return `${orders.length}/4 orders placed`
}

const EventSummary = ({
  event,
  baseDecimals,
  quoteDecimals,
  baseSymbol,
  quoteSymbol,
  baseCoinType,
  quoteCoinType
}: {
  event: ExecutorEvent
  baseDecimals: number
  quoteDecimals: number
  baseSymbol: string
  quoteSymbol: string
  baseCoinType: string
  quoteCoinType: string
}) => {
  switch (event.type) {
    case "ExecutorCreated":
      return <>Executor created.</>
    case "QuoteUpdated": {
      const price = formatDeepbookPrice(
        event.data.price as string | undefined,
        baseDecimals,
        quoteDecimals
      )
      return (
        <>
          Mid {price} · {orderIdSummary(event.data)}
        </>
      )
    }
    case "ExecutorPaused":
      return <>Trading paused.</>
    case "ExecutorUnpaused":
      return <>Trading resumed.</>
    case "ExecutorConfigUpdated":
      return <>AMM configuration replaced.</>
    case "Deposited":
    case "Withdrawn": {
      const coinTypeRaw = event.data.coin_type as
        | { name?: string }
        | string
        | undefined
      const coinTypeName =
        typeof coinTypeRaw === "string"
          ? coinTypeRaw
          : (coinTypeRaw?.name ?? "")
      const isBase =
        coinTypeName.toLowerCase() === baseCoinType.toLowerCase() ||
        coinTypeName.toLowerCase().endsWith(baseCoinType.toLowerCase())
      const isQuote =
        coinTypeName.toLowerCase() === quoteCoinType.toLowerCase() ||
        coinTypeName.toLowerCase().endsWith(quoteCoinType.toLowerCase())
      const decimals = isBase
        ? baseDecimals
        : isQuote
          ? quoteDecimals
          : undefined
      const symbol = isBase ? baseSymbol : isQuote ? quoteSymbol : undefined
      const amount = event.data.amount as string | undefined
      if (amount && decimals !== undefined) {
        return (
          <>
            {formatCoinBalance({ balance: amount, decimals })} {symbol ?? ""}
          </>
        )
      }
      return <>{amount ?? "—"} (raw atoms)</>
    }
    default:
      return <>—</>
  }
}

const EventFeedCard = () => {
  const { resolution, overview } = useTraderAccountContext()
  const packageId = useResolvedPackageId()
  const events = useExecutorEventLog({
    packageId,
    executorId: resolution.traderAccountId,
    limit: 50
  })

  const traderAccount = overview.traderAccount
  const baseDecimals = traderAccount?.baseDecimals ?? 9
  const quoteDecimals = traderAccount?.quoteDecimals ?? 9
  const baseCoinType = traderAccount?.baseCoinType ?? ""
  const quoteCoinType = traderAccount?.quoteCoinType ?? ""
  const baseSymbol = baseCoinType.split("::").pop() ?? ""
  const quoteSymbol = quoteCoinType.split("::").pop() ?? ""

  const reversed = [...events].reverse() // newest first for display

  return (
    <section className="flex h-full w-full max-w-4xl flex-col px-4 lg:px-0">
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-50/30 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
              Event feed
            </h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              On-chain events from{" "}
              <code className="font-mono text-[0.7rem]">
                openzeppelin_market_maker::events
              </code>
            </p>
          </div>
          <span className="bg-sds-blue/10 rounded-full px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-sds-blue">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {reversed.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-200/70">
              No events yet. Trigger a deposit, withdraw, or
              refresh_quotes_permissionless to populate this feed.
            </div>
          ) : (
            <ul className="divide-y divide-slate-200/70 dark:divide-slate-50/10">
              {reversed.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start gap-3 px-4 py-3 text-xs"
                >
                  <span
                    className={`whitespace-nowrap rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.12em] ${TYPE_TONE[event.type]}`}
                  >
                    {event.type}
                  </span>
                  <div className="min-w-0 flex-1 text-slate-700 dark:text-slate-100">
                    <EventSummary
                      event={event}
                      baseDecimals={baseDecimals}
                      quoteDecimals={quoteDecimals}
                      baseSymbol={baseSymbol}
                      quoteSymbol={quoteSymbol}
                      baseCoinType={baseCoinType}
                      quoteCoinType={quoteCoinType}
                    />
                  </div>
                  <span className="whitespace-nowrap font-mono text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                    {formatTimestamp(event.timestampMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export default EventFeedCard
