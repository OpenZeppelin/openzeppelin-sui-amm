"use client"

import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { formatCoinBalance } from "@sui-amm/tooling-core/utils/formatters"
import { useMemo } from "react"
import { useAccumulatedDeepbookOrderFills } from "../hooks/useAccumulatedDeepbookOrderFills"
import type { DeepbookOrderFill } from "../hooks/useDeepbookOrderFills"
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

const safeNormalize = (value?: string) => {
  if (!value) return undefined
  try {
    return normalizeSuiObjectId(value)
  } catch {
    return undefined
  }
}

/**
 * Derive (orderId, side) for one of the executor's fills using only the
 * `OrderFilled` event payload — `taker_is_bid` tells us the taker's
 * direction, and whether the executor's BalanceManager sat on the maker or
 * taker side flips that to the AMM's order side.
 *
 * Skipping the `QuoteUpdated` cross-reference entirely makes every fill
 * showable: we no longer drop rows when an old `QuoteUpdated` has aged out
 * of the shared poller's event window.
 */
const resolveOurFillRole = (
  fill: DeepbookOrderFill,
  balanceManagerId: string
): { orderId: string; side: "BUY" | "SELL" } | undefined => {
  if (fill.makerBalanceManagerId === balanceManagerId) {
    return {
      orderId: fill.makerOrderId,
      // Maker rests on the opposite side of the taker.
      side: fill.takerIsBid ? "SELL" : "BUY"
    }
  }
  if (fill.takerBalanceManagerId === balanceManagerId) {
    return {
      orderId: fill.takerOrderId,
      // Taker is on the same side as the market-order direction.
      side: fill.takerIsBid ? "BUY" : "SELL"
    }
  }
  return undefined
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
  const { overview } = useTraderAccountContext()
  const traderAccount = overview.traderAccount
  // The accumulated stream is held in a module-scoped store keyed by
  // (pool, BalanceManager), so it survives navigation between terminal pages
  // — the local rows used to reset every time the user clicked away.
  const fills = useAccumulatedDeepbookOrderFills({
    poolId: traderAccount?.poolId,
    balanceManagerId: traderAccount?.balanceManagerId
  })

  const rows = useMemo<TradeRow[]>(() => {
    if (!traderAccount) return []
    const balanceManagerId = safeNormalize(traderAccount.balanceManagerId)
    if (!balanceManagerId) return []
    const out: TradeRow[] = []
    for (const fill of fills) {
      const role = resolveOurFillRole(fill, balanceManagerId)
      if (!role) continue
      out.push({
        key: fill.eventId,
        orderId: role.orderId,
        side: role.side,
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
  }, [fills, traderAccount])

  return (
    <section className={cardClassName}>
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
          Trade History
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-200/70">
          DeepBook `OrderFilled` events that touch the executor's
          BalanceManager. Side is derived from `taker_is_bid` plus whether the
          executor sat on the maker or taker side of the trade.
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
                  <td className="py-2 pr-4 text-right font-mono">
                    {row.price}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono">
                    {row.quantity}
                  </td>
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

export default TradeHistoryCard
