"use client"

import type { SuiEvent } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { useMemo } from "react"
import useDeploymentArtifacts from "./useDeploymentArtifacts"
import useMoveModuleEvents from "./useMoveModuleEvents"

const safeNormalize = (value?: string) => {
  if (!value) return undefined
  try {
    return normalizeSuiObjectId(value)
  } catch {
    return undefined
  }
}

const eventIdString = (id: { txDigest: string; eventSeq: string }) =>
  `${id.txDigest}:${id.eventSeq}`

export type DeepbookOrderFill = {
  /** Unique id (`<txDigest>:<eventSeq>`). Used for dedupe + React keys. */
  eventId: string
  txDigest: string
  /** Block timestamp in ms, or null when the indexer hasn't backfilled yet. */
  timestampMs: number | null
  poolId: string
  /** u128 order ids as decimal strings — easier to compare with `LimitOrder.order_id` from QuoteUpdated. */
  makerOrderId: string
  takerOrderId: string
  /** DeepBook fixed-point price (`quote_atoms * 1e9 / base_atoms`) as a u64 string. */
  price: string
  baseQuantity: string
  quoteQuantity: string
  takerIsBid: boolean
  makerBalanceManagerId: string
  takerBalanceManagerId: string
}

type RawOrderFilled = {
  pool_id?: string
  maker_order_id?: string | number
  taker_order_id?: string | number
  price?: string | number
  base_quantity?: string | number
  quote_quantity?: string | number
  taker_is_bid?: boolean
  maker_balance_manager_id?: string
  taker_balance_manager_id?: string
}

const toFill = (event: SuiEvent): DeepbookOrderFill | undefined => {
  if (!event.type.endsWith("::order_info::OrderFilled")) return undefined
  const data = event.parsedJson as RawOrderFilled | undefined
  if (!data) return undefined
  const poolId = safeNormalize(data.pool_id)
  const makerBmId = safeNormalize(data.maker_balance_manager_id)
  const takerBmId = safeNormalize(data.taker_balance_manager_id)
  if (!poolId || !makerBmId || !takerBmId) return undefined
  return {
    eventId: eventIdString(event.id),
    txDigest: event.id.txDigest,
    timestampMs: event.timestampMs ? Number(event.timestampMs) : null,
    poolId,
    makerOrderId: String(data.maker_order_id ?? ""),
    takerOrderId: String(data.taker_order_id ?? ""),
    price: String(data.price ?? "0"),
    baseQuantity: String(data.base_quantity ?? "0"),
    quoteQuantity: String(data.quote_quantity ?? "0"),
    takerIsBid: Boolean(data.taker_is_bid),
    makerBalanceManagerId: makerBmId,
    takerBalanceManagerId: takerBmId
  }
}

/**
 * Returns every DeepBook `OrderFilled` event that touched `balanceManagerId`
 * on `poolId`, sorted newest-first. Backed by the shared
 * `useMoveModuleEvents` poller for the deepbook `order_info` module — no
 * extra subscriptions or pollers are spun up per consumer.
 */
export const useDeepbookOrderFills = ({
  poolId,
  balanceManagerId
}: {
  poolId?: string
  balanceManagerId?: string
}): DeepbookOrderFill[] => {
  const { deepbookPackageId } = useDeploymentArtifacts()
  const rawEvents = useMoveModuleEvents({
    packageId: deepbookPackageId,
    module: "order_info"
  })

  return useMemo(() => {
    const normalizedPool = safeNormalize(poolId)
    const normalizedBm = safeNormalize(balanceManagerId)
    if (!normalizedPool || !normalizedBm) return []
    const fills: DeepbookOrderFill[] = []
    for (const event of rawEvents) {
      const fill = toFill(event)
      if (!fill) continue
      if (fill.poolId !== normalizedPool) continue
      if (
        fill.makerBalanceManagerId !== normalizedBm &&
        fill.takerBalanceManagerId !== normalizedBm
      ) {
        continue
      }
      fills.push(fill)
    }
    // queryEvents already returns newest-first; preserve that order.
    return fills
  }, [balanceManagerId, poolId, rawEvents])
}

export default useDeepbookOrderFills
