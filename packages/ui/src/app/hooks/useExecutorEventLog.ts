"use client"

import type { SuiEvent } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { useMemo } from "react"
import useMoveModuleEvents from "./useMoveModuleEvents"

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
}): ExecutorEvent[] => {
  const rawEvents = useMoveModuleEvents({
    packageId,
    module: "events"
  })

  return useMemo(() => {
    const normalizedExecutorId = safeNormalize(executorId)
    if (!normalizedExecutorId) return []
    const filtered: ExecutorEvent[] = []
    for (const event of rawEvents) {
      if (!matchesExecutor(event, normalizedExecutorId)) continue
      const parsed = toExecutorEvent(event)
      if (!parsed) continue
      filtered.push(parsed)
      if (filtered.length >= limit) break
    }
    return sortByTimeAscending(filtered)
  }, [executorId, limit, rawEvents])
}

export default useExecutorEventLog
