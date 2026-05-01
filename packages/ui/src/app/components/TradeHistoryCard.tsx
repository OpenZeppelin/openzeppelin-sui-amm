"use client"

import { formatCoinBalance } from "@sui-amm/tooling-core/utils/formatters"
import { useMemo } from "react"
import {
  useExecutorEventLog,
  type ExecutorEvent
} from "../hooks/useExecutorEventLog"
import {
  useDeepbookOrderFills,
  type DeepbookOrderFill
} from "../hooks/useDeepbookOrderFills"
import useResolvedPackageId from "../hooks/useResolvedPackageId"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import { shortenId } from "../helpers/format"

type TradeRow = {
  key: string
  orderId: string
  side: "BUY" | "SELL"
  price: string
  quantity: string
  timestamp: string
}

type LimitOrderEntry = {
  order_id?: string | number
  is_bid?: boolean
}

/**
 * Fold every `QuoteUpdated` event into a `Map<orderIdDecimalString, isBid>`
 * so we can look up the side an AMM order was placed with even after it has
 * been cancelled / replaced by a later refresh. Order ids are u128, parsed
 * to decimal strings to match DeepBook event payloads exactly.
 */
const buildOrderSideMap = (events: ExecutorEvent[]): Map<string, boolean> => {
  const map = new Map<string, boolean>()
  for (const event of events) {
    if (event.type !== "QuoteUpdated") continue
    const orders = (event.data as { orders?: unknown }).orders
    if (!Array.isArray(orders)) continue
    for (const order of orders as LimitOrderEntry[]) {
      const orderId = order.order_id
      if (orderId === undefined || orderId === null) continue
      const idStr = String(orderId)
      if (!idStr) continue
      // Older entries may already be in the map; keep the first observation
      // (the moment the AMM placed the order). Subsequent QuoteUpdated events
      // shouldn't change `is_bid` for an existing order id.
      if (!map.has(idStr)) map.set(idStr, Boolean(order.is_bid))
    }
  }
  return map
}

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return "—"
  const date = new Date(ms)
  // Locale-aware HH:MM:SS plus an MMM DD prefix; readable at a glance and
  // includes seconds since fills land sub-minute on a busy market.
  return `${date.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit"
  })} ${date.toLocaleTimeString(undefined, { hour12: false })}`
}

const PRICE_RAW_DECIMALS = 9 // DeepBook fixed-point base.

const formatPrice = ({
  rawPrice,
  baseDecimals,
  quoteDecimals
}: {
  rawPrice: string
  baseDecimals: number
  quoteDecimals: number
}): string => {
  // `rawPrice * 10^quoteDecimals / (10^9 * 10^baseDecimals)` in human units;
  // formatCoinBalance handles the 1e9 scaling via the adjustedDecimals shift.
  const adjusted = PRICE_RAW_DECIMALS - baseDecimals + quoteDecimals
  if (adjusted < 0) return rawPrice
  return formatCoinBalance({
    balance: rawPrice,
    decimals: adjusted,
    maxFractionDigits: 6
  })
}

// Cap the displayed history at the most recent 100 fills so the table stays
// snappy even after a long trading session. Anything older is dropped from
// view (the on-chain stream still has it).
const MAX_ROWS = 100
// Fits ~10 rows (each `py-2` + content ≈ 32px) before the user has to scroll.
const SCROLL_MAX_HEIGHT_PX = 360

const cardClassName =
  "rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70"

const TradeHistoryCard = () => {
  const { resolution, overview } = useTraderAccountContext()
  const packageId = useResolvedPackageId()
  const traderAccount = overview.traderAccount
  const events = useExecutorEventLog({
    packageId,
    executorId: resolution.traderAccountId,
    limit: 500
  })
  const fills = useDeepbookOrderFills({
    poolId: traderAccount?.poolId,
    balanceManagerId: traderAccount?.balanceManagerId
  })

  const orderSideMap = useMemo(() => buildOrderSideMap(events), [events])

  const rows = useMemo<TradeRow[]>(() => {
    if (!traderAccount) return []
    const out: TradeRow[] = []
    for (const fill of fills) {
      const ourId = pickMatchingOrderId(fill, orderSideMap)
      if (!ourId) continue
      const isBid = orderSideMap.get(ourId)
      if (isBid === undefined) continue
      out.push({
        key: fill.eventId,
        orderId: ourId,
        side: isBid ? "BUY" : "SELL",
        price: formatPrice({
          rawPrice: fill.price,
          baseDecimals: traderAccount.baseDecimals,
          quoteDecimals: traderAccount.quoteDecimals
        }),
        quantity: formatCoinBalance({
          balance: fill.baseQuantity,
          decimals: traderAccount.baseDecimals
        }),
        timestamp: formatTimestamp(fill.timestampMs)
      })
      if (out.length >= MAX_ROWS) break
    }
    return out
  }, [fills, orderSideMap, traderAccount])

  return (
    <section className={cardClassName}>
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
          Trade History
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-200/70">
          DeepBook `OrderFilled` events that match one of the executor's
          posted orders. Side is taken from the
          <code className="font-mono"> QuoteUpdated </code>
          payload that placed the matching order.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200/70 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-50/15 dark:text-slate-200/70">
          No fills yet.
        </div>
      ) : (
        <div
          className="overflow-auto"
          style={{ maxHeight: SCROLL_MAX_HEIGHT_PX }}
        >
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white/90 dark:bg-slate-950/70">
              <tr className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                <th className="py-2 pr-4 font-medium">Order ID</th>
                <th className="py-2 pr-4 font-medium">Side</th>
                <th className="py-2 pr-4 text-right font-medium">Price</th>
                <th className="py-2 pr-4 text-right font-medium">QTY</th>
                <th className="py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-slate-50/10">
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className="text-slate-700 dark:text-slate-100"
                >
                  <td
                    className="py-2 pr-4 font-mono text-[0.7rem] text-slate-600 dark:text-slate-200/80"
                    title={row.orderId}
                  >
                    {shortenId(row.orderId, 6, 4)}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={[
                        "inline-flex rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold",
                        row.side === "BUY"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                          : "bg-rose-500/10 text-rose-700 dark:text-rose-200"
                      ].join(" ")}
                    >
                      {row.side}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right font-mono">{row.price}</td>
                  <td className="py-2 pr-4 text-right font-mono">{row.quantity}</td>
                  <td className="py-2 font-mono text-[0.7rem] text-slate-500 dark:text-slate-200/70">
                    {row.timestamp}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const pickMatchingOrderId = (
  fill: DeepbookOrderFill,
  orderSideMap: Map<string, boolean>
): string | undefined => {
  if (orderSideMap.has(fill.makerOrderId)) return fill.makerOrderId
  if (orderSideMap.has(fill.takerOrderId)) return fill.takerOrderId
  return undefined
}

export default TradeHistoryCard
