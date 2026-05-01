"use client"

import {
  formatCoinBalance,
  getStructLabel
} from "@sui-amm/tooling-core/utils/formatters"
import { useMemo } from "react"
import { useDeepbookFullyFilledOrders } from "../hooks/useDeepbookFullyFilledOrders"
import { useExecutorEventLog } from "../hooks/useExecutorEventLog"
import useResolvedPackageId from "../hooks/useResolvedPackageId"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"

type ParsedOrder = {
  orderId: string
  price: bigint
  quantity: bigint
  isBid: boolean
}

const isPlainOrder = (
  candidate: unknown
): candidate is {
  order_id: string | number
  price: string | number
  quantity: string | number
  is_bid: boolean
} => {
  if (!candidate || typeof candidate !== "object") return false
  const value = candidate as Record<string, unknown>
  return (
    (typeof value.order_id === "string" ||
      typeof value.order_id === "number") &&
    (typeof value.price === "string" || typeof value.price === "number") &&
    (typeof value.quantity === "string" ||
      typeof value.quantity === "number") &&
    typeof value.is_bid === "boolean"
  )
}

const parseOrders = (raw: unknown): ParsedOrder[] => {
  if (!Array.isArray(raw)) return []
  const parsed: ParsedOrder[] = []
  for (const entry of raw) {
    if (!isPlainOrder(entry)) continue
    let price: bigint
    let quantity: bigint
    try {
      price = BigInt(entry.price)
      quantity = BigInt(entry.quantity)
    } catch {
      continue
    }
    parsed.push({
      orderId: String(entry.order_id),
      price,
      quantity,
      isBid: entry.is_bid
    })
  }
  // Sort by price descending (highest first).
  return parsed.sort((left, right) => {
    if (left.price > right.price) return -1
    if (left.price < right.price) return 1
    return 0
  })
}

const SidePill = ({ isBid }: { isBid: boolean }) => {
  const tone = isBid
    ? "bg-emerald-100/80 text-emerald-700 border-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30"
    : "bg-rose-100/80 text-rose-700 border-rose-200/70 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-500/30"
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] ${tone}`}
    >
      {isBid ? "Bid" : "Ask"}
    </span>
  )
}

const StatusPill = ({ status }: { status: "OPEN" | "FILLED" }) => {
  const tone =
    status === "FILLED"
      ? "bg-sds-blue/10 text-sds-blue border-sds-blue/30"
      : "bg-slate-100/80 text-slate-600 border-slate-200/70 dark:bg-slate-50/10 dark:text-slate-200/80 dark:border-slate-50/15"
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] ${tone}`}
    >
      {status}
    </span>
  )
}

const formatDeepbookPrice = (
  rawPrice: bigint,
  baseDecimals: number,
  quoteDecimals: number
) => {
  const adjustedDecimals = 9 - baseDecimals + quoteDecimals
  if (adjustedDecimals < 0) return `${rawPrice} (raw)`
  return formatCoinBalance({
    balance: rawPrice.toString(),
    decimals: adjustedDecimals,
    maxFractionDigits: 6
  })
}

const ActiveOrdersCard = () => {
  const { resolution, overview } = useTraderAccountContext()
  const packageId = useResolvedPackageId()
  const events = useExecutorEventLog({
    packageId,
    executorId: resolution.traderAccountId,
    limit: 50
  })
  const traderAccount = overview.traderAccount

  const filledOrderIds = useDeepbookFullyFilledOrders({
    poolId: traderAccount?.poolId,
    balanceManagerId: traderAccount?.balanceManagerId
  })

  const orders = useMemo(() => {
    // The most recent QuoteUpdated cancels all prior orders, so its `orders`
    // field is the live snapshot.
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.type !== "QuoteUpdated") continue
      return parseOrders((event.data as { orders?: unknown }).orders)
    }
    return []
  }, [events])

  const baseSymbol = traderAccount
    ? getStructLabel(traderAccount.baseCoinType)
    : ""
  const baseDecimals = traderAccount?.baseDecimals ?? 9
  const quoteDecimals = traderAccount?.quoteDecimals ?? 9

  return (
    <section className="w-full max-w-4xl px-4 lg:px-0">
      <div className="rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-50/30 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
              Active orders
            </h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              From the most recent QuoteUpdated · cancelled on next refresh
            </p>
          </div>
          <span className="bg-sds-blue/10 rounded-full px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-sds-blue">
            {orders.length} placed
          </span>
        </div>
        <div className="px-2 py-2">
          {orders.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-200/70">
              No active orders. Trigger refresh_quotes_permissionless on /bot to
              place orders.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  <th className="px-4 py-2 font-semibold">Side</th>
                  <th className="px-4 py-2 text-right font-semibold">Price</th>
                  <th className="px-4 py-2 text-right font-semibold">
                    Quantity ({baseSymbol})
                  </th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-50/10">
                {orders.map((order) => {
                  const status: "OPEN" | "FILLED" = filledOrderIds.has(
                    order.orderId
                  )
                    ? "FILLED"
                    : "OPEN"
                  return (
                    <tr key={order.orderId}>
                      <td className="px-4 py-2">
                        <SidePill isBid={order.isBid} />
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700 dark:text-slate-100">
                        {formatDeepbookPrice(
                          order.price,
                          baseDecimals,
                          quoteDecimals
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700 dark:text-slate-100">
                        {formatCoinBalance({
                          balance: order.quantity.toString(),
                          decimals: baseDecimals
                        })}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill status={status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}

export default ActiveOrdersCard
