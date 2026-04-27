"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import type { SuiClient } from "@mysten/sui/client"
import { Transaction } from "@mysten/sui/transactions"
import { bcs } from "@mysten/sui/bcs"
import { useEffect, useRef, useState } from "react"

import { SUI_CLOCK_ID } from "@sui-amm/tooling-core/constants"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"

import type { ExecutorEvent } from "./useExecutorEventLog"

// Sentinel value stored when `pool::mid_price` aborted (e.g., one side of the
// book is empty). Chart skips these — line gets a gap rather than a zero spike.
type DeepbookMidEntry = bigint | "error"

const PROBE_SENDER =
  "0x0000000000000000000000000000000000000000000000000000000000000001"

const fetchDeepbookMidPrice = async ({
  suiClient,
  deepbookPackageId,
  poolId,
  baseCoinType,
  quoteCoinType
}: {
  suiClient: SuiClient
  deepbookPackageId: string
  poolId: string
  baseCoinType: string
  quoteCoinType: string
}): Promise<bigint | undefined> => {
  // Run as its own dev-inspect call (NOT bundled with refresh_quotes_permissionless) so an
  // abort here just signals "no data" instead of breaking the trader's PTB.
  const poolShared = await getSuiSharedObject(
    { objectId: poolId, mutable: false },
    { suiClient }
  )

  const transaction = new Transaction()
  transaction.moveCall({
    target: `${deepbookPackageId}::pool::mid_price`,
    typeArguments: [baseCoinType, quoteCoinType],
    arguments: [
      transaction.sharedObjectRef(poolShared.sharedRef),
      transaction.object(SUI_CLOCK_ID)
    ]
  })

  const inspect = await suiClient.devInspectTransactionBlock({
    sender: PROBE_SENDER,
    transactionBlock: transaction
  })

  if (inspect.effects.status.status !== "success") return undefined
  const returnValue = inspect.results?.[0]?.returnValues?.[0]
  if (!returnValue) return undefined
  const [bytes, type] = returnValue
  if (type !== "u64") return undefined
  return BigInt(bcs.u64().parse(Uint8Array.from(bytes)))
}

/**
 * For each QuoteUpdated event observed, fetch the DeepBook book mid via a
 * one-call dev-inspect. Results are cached by event id so we only fetch once
 * per event. Aborts (one-sided book) are recorded as `"error"` so the chart
 * can skip the point.
 */
export const useDeepbookMidPrices = ({
  events,
  deepbookPackageId,
  poolId,
  baseCoinType,
  quoteCoinType
}: {
  events: ExecutorEvent[]
  deepbookPackageId?: string
  poolId?: string
  baseCoinType?: string
  quoteCoinType?: string
}): Map<string, DeepbookMidEntry> => {
  const suiClient = useSuiClient()
  const [byEventId, setByEventId] = useState<Map<string, DeepbookMidEntry>>(
    () => new Map()
  )
  const inFlightRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!deepbookPackageId || !poolId || !baseCoinType || !quoteCoinType) return
    const pending = events.filter(
      (event) =>
        event.type === "QuoteUpdated" &&
        !byEventId.has(event.id) &&
        !inFlightRef.current.has(event.id)
    )
    if (pending.length === 0) return

    pending.forEach((event) => inFlightRef.current.add(event.id))

    let cancelled = false
    void Promise.all(
      pending.map(async (event) => {
        try {
          const mid = await fetchDeepbookMidPrice({
            suiClient,
            deepbookPackageId,
            poolId,
            baseCoinType,
            quoteCoinType
          })
          return [event.id, mid ?? "error"] as const
        } catch {
          return [event.id, "error"] as const
        }
      })
    ).then((entries) => {
      // Always release the in-flight slots — even on cancellation, those requests are
      // no longer pending, and leaving the ids in the set would skip them forever.
      pending.forEach((event) => inFlightRef.current.delete(event.id))
      if (cancelled) return
      setByEventId((current) => {
        const next = new Map(current)
        for (const [id, value] of entries) next.set(id, value)
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [
    events,
    suiClient,
    deepbookPackageId,
    poolId,
    baseCoinType,
    quoteCoinType,
    byEventId
  ])

  return byEventId
}

export type { DeepbookMidEntry }
