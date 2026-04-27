"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import type { SuiEvent } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { useEffect, useState } from "react"

export type ExecutorEventType =
  | "ExecutorCreated"
  | "QuoteUpdated"
  | "ExecutorPaused"
  | "ExecutorUnpaused"
  | "ExecutorConfigUpdated"
  | "Deposited"
  | "Withdrawn"

export type ExecutorEvent = {
  /** Unique id (`<txDigest>:<eventSeq>`). Used for dedupe + React keys. */
  id: string
  type: ExecutorEventType
  /** Timestamp ms; null when the indexer hasn't backfilled it yet. */
  timestampMs: number | null
  txDigest: string
  /** Raw parsed payload from RPC. Field names are snake_case (Move). */
  data: Record<string, unknown>
}

const eventIdString = (id: { txDigest: string; eventSeq: string }) =>
  `${id.txDigest}:${id.eventSeq}`

const safeNormalize = (value?: string) => {
  if (!value) return undefined
  try {
    return normalizeSuiObjectId(value)
  } catch {
    return undefined
  }
}

const parseExecutorEventType = (
  rawType: string
): ExecutorEventType | undefined => {
  // rawType looks like "<packageId>::events::QuoteUpdated"
  const lastSegment = rawType.split("::").pop()
  if (!lastSegment) return undefined
  switch (lastSegment) {
    case "ExecutorCreated":
    case "QuoteUpdated":
    case "ExecutorPaused":
    case "ExecutorUnpaused":
    case "ExecutorConfigUpdated":
    case "Deposited":
    case "Withdrawn":
      return lastSegment
    default:
      return undefined
  }
}

const matchesExecutor = (
  event: SuiEvent,
  normalizedExecutorId: string
): boolean => {
  const data = event.parsedJson as { executor_id?: unknown } | undefined
  const eventExecutorId =
    typeof data?.executor_id === "string"
      ? safeNormalize(data.executor_id)
      : undefined
  return eventExecutorId === normalizedExecutorId
}

const toExecutorEvent = (event: SuiEvent): ExecutorEvent | undefined => {
  const type = parseExecutorEventType(event.type)
  if (!type) return undefined
  const timestampMs = event.timestampMs ? Number(event.timestampMs) : null
  return {
    id: eventIdString(event.id),
    type,
    timestampMs,
    txDigest: event.id.txDigest,
    data: (event.parsedJson as Record<string, unknown>) ?? {}
  }
}

const dedupeAndCap = (current: ExecutorEvent[], limit: number) => {
  const seen = new Set<string>()
  const result: ExecutorEvent[] = []
  // Preserve insertion order; iterate latest-first so newer entries win on dedupe.
  for (let i = current.length - 1; i >= 0; i--) {
    const event = current[i]
    if (seen.has(event.id)) continue
    seen.add(event.id)
    result.push(event)
    if (result.length >= limit) break
  }
  return result.reverse()
}

const sortByTimeAscending = (events: ExecutorEvent[]) =>
  [...events].sort((left, right) => {
    const leftTime = left.timestampMs ?? 0
    const rightTime = right.timestampMs ?? 0
    if (leftTime !== rightTime) return leftTime - rightTime
    return left.id.localeCompare(right.id)
  })

export const useExecutorEventLog = ({
  packageId,
  executorId,
  limit = 50
}: {
  packageId?: string
  executorId?: string
  limit?: number
}) => {
  const suiClient = useSuiClient()
  const [events, setEvents] = useState<ExecutorEvent[]>([])

  useEffect(() => {
    if (!packageId || !executorId) {
      setEvents([])
      return
    }

    const normalizedExecutorId = safeNormalize(executorId)
    if (!normalizedExecutorId) {
      setEvents([])
      return
    }

    let cancelled = false
    let unsubscribeFn: (() => Promise<boolean>) | undefined

    const backfill = async () => {
      try {
        const result = await suiClient.queryEvents({
          query: { MoveEventModule: { package: packageId, module: "events" } },
          limit,
          order: "descending"
        })
        if (cancelled) return
        const filtered = result.data
          .filter((event) => matchesExecutor(event, normalizedExecutorId))
          .map(toExecutorEvent)
          .filter((event): event is ExecutorEvent => event !== undefined)
        setEvents(sortByTimeAscending(filtered))
      } catch (error) {
        console.warn("Event backfill failed:", error)
      }
    }

    const startSubscription = async () => {
      try {
        const fn = await suiClient.subscribeEvent({
          filter: { MoveEventModule: { package: packageId, module: "events" } },
          onMessage: (event) => {
            if (cancelled) return
            if (!matchesExecutor(event, normalizedExecutorId)) return
            const parsed = toExecutorEvent(event)
            if (!parsed) return
            setEvents((previous) => dedupeAndCap([...previous, parsed], limit))
          }
        })
        if (cancelled) {
          await fn()
          return
        }
        unsubscribeFn = fn
      } catch (error) {
        console.warn("Event subscription failed:", error)
      }
    }

    void backfill()
    void startSubscription()

    return () => {
      cancelled = true
      if (unsubscribeFn) void unsubscribeFn()
    }
  }, [executorId, limit, packageId, suiClient])

  return events
}

export default useExecutorEventLog
