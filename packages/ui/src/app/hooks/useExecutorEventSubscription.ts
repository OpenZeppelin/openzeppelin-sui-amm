"use client"

import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { useEffect, useRef } from "react"
import useMoveModuleEvents from "./useMoveModuleEvents"

const safeNormalize = (value?: string) => {
  if (!value) return undefined
  try {
    return normalizeSuiObjectId(value)
  } catch {
    return undefined
  }
}

/**
 * Fires `onEvent` whenever a fresh event in `<package>::events::*` matches
 * `executor_id == executorId` — used as a "data changed" signal that drives
 * the trader-account refetch. Backed by the shared `useMoveModuleEvents`
 * poller, so adding a consumer is free (no extra `queryEvents` calls).
 *
 * "Fresh" means an event id (`<txDigest>:<eventSeq>`) that wasn't already in
 * the previous snapshot — so an `onEvent` only fires once per real change,
 * not on every poll tick.
 */
export const useExecutorEventSubscription = ({
  packageId,
  executorId,
  onEvent
}: {
  packageId?: string
  executorId?: string
  onEvent: () => void
}) => {
  const events = useMoveModuleEvents({ packageId, module: "events" })
  const seenRef = useRef<Set<string>>(new Set())
  // Latest callback is captured in a ref so a parent that reidentifies
  // `onEvent` between renders doesn't reset the seen-event cache.
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!packageId || !executorId) return
    const normalizedExecutorId = safeNormalize(executorId)
    if (!normalizedExecutorId) return

    let firedThisPass = false
    for (const event of events) {
      const id = `${event.id.txDigest}:${event.id.eventSeq}`
      if (seenRef.current.has(id)) continue
      const data = event.parsedJson as { executor_id?: unknown } | undefined
      const eventExecutorId =
        typeof data?.executor_id === "string"
          ? safeNormalize(data.executor_id)
          : undefined
      seenRef.current.add(id)
      if (
        eventExecutorId === normalizedExecutorId &&
        !firedThisPass
      ) {
        // Coalesce — multiple new matching events in a single batch only
        // trigger one refetch.
        firedThisPass = true
        onEventRef.current()
      }
    }
  }, [events, executorId, packageId])
}

export default useExecutorEventSubscription
