"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import type { SuiClient, SuiEvent } from "@mysten/sui/client"
import { useEffect, useState } from "react"

// Default cap on how many recent events the poller pulls per `queryEvents`
// call. Generous enough that a busy DeepBook pool's fill history stays in
// the table for a while, small enough that the response stays cheap.
const DEFAULT_EVENT_LIMIT = 500
// Polling cadence shared across all consumers. `subscribeEvent` over WS is
// disabled on Sui ≥1.70 localnet (and deprecated in the SDK), so a short
// poll is the cheapest reliable signal we have.
const DEFAULT_POLL_INTERVAL_MS = 2_000

type SubscriberCallback = (events: SuiEvent[]) => void

type PollerState = {
  events: SuiEvent[]
  subscribers: Set<SubscriberCallback>
  intervalHandle: ReturnType<typeof setInterval>
  inFlight: boolean
}

// Module-scoped registry: at most one poller per `(suiClient, package, module)`.
// Each new hook instance for the same key joins the existing subscriber set so
// we never run redundant `queryEvents` requests for the same filter. The
// per-caller display limit is intentionally NOT in the key — consumers should
// slice the shared snapshot to whatever subset they need.
const pollers = new WeakMap<SuiClient, Map<string, PollerState>>()

const filterKey = (packageId: string, module: string) =>
  `${packageId}|${module}`

const getRegistryFor = (suiClient: SuiClient) => {
  let registry = pollers.get(suiClient)
  if (!registry) {
    registry = new Map()
    pollers.set(suiClient, registry)
  }
  return registry
}

const eventIdsEqual = (before: SuiEvent[], after: SuiEvent[]): boolean => {
  if (before.length !== after.length) return false
  for (let index = 0; index < before.length; index += 1) {
    const a = before[index]
    const b = after[index]
    if (a.id.txDigest !== b.id.txDigest || a.id.eventSeq !== b.id.eventSeq) {
      return false
    }
  }
  return true
}

const tickPoller = async (
  suiClient: SuiClient,
  packageId: string,
  module: string,
  limit: number,
  state: PollerState
) => {
  if (state.inFlight) return
  state.inFlight = true
  try {
    const result = await suiClient.queryEvents({
      query: { MoveEventModule: { package: packageId, module } },
      limit,
      order: "descending"
    })
    if (eventIdsEqual(state.events, result.data)) return
    state.events = result.data
    for (const subscriber of state.subscribers) subscriber(result.data)
  } catch (error) {
    // Swallow transient RPC errors; the next tick retries. Keeps the page
    // alive when the chain restarts mid-session.
    console.warn(
      `Move module event poll failed (${packageId}::${module}):`,
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    state.inFlight = false
  }
}

const startPoller = (
  suiClient: SuiClient,
  packageId: string,
  module: string,
  limit: number,
  intervalMs: number
): PollerState => {
  const state: PollerState = {
    events: [],
    subscribers: new Set(),
    intervalHandle: setInterval(
      () => void tickPoller(suiClient, packageId, module, limit, state),
      intervalMs
    ),
    inFlight: false
  }
  // Fire one immediately so the first subscriber sees data without waiting
  // an entire `intervalMs` tick.
  void tickPoller(suiClient, packageId, module, limit, state)
  return state
}

/**
 * Subscribes to a polled stream of events emitted by `<package>::<module>::*`,
 * deduped at the registry level so any number of consumers that share the
 * same `(package, module, limit)` triple back a single `queryEvents` poll.
 *
 * Returns the latest event batch newest-first (matching `queryEvents`'
 * `order: "descending"`). Consumers that need typed payloads or extra
 * filters should `useMemo` over the return value.
 */
export const useMoveModuleEvents = ({
  packageId,
  module,
  intervalMs = DEFAULT_POLL_INTERVAL_MS
}: {
  packageId?: string
  module?: string
  intervalMs?: number
}): SuiEvent[] => {
  const suiClient = useSuiClient()
  const [events, setEvents] = useState<SuiEvent[]>([])

  useEffect(() => {
    if (!packageId || !module) {
      setEvents([])
      return
    }

    const registry = getRegistryFor(suiClient)
    const key = filterKey(packageId, module)
    let state = registry.get(key)
    if (!state) {
      state = startPoller(
        suiClient,
        packageId,
        module,
        DEFAULT_EVENT_LIMIT,
        intervalMs
      )
      registry.set(key, state)
    }

    const subscriber: SubscriberCallback = (next) => setEvents(next)
    state.subscribers.add(subscriber)
    // Hand the consumer the cached snapshot immediately; otherwise they'd
    // see an empty array until the next poll tick fires.
    setEvents(state.events)

    return () => {
      const current = registry.get(key)
      if (!current) return
      current.subscribers.delete(subscriber)
      if (current.subscribers.size === 0) {
        clearInterval(current.intervalHandle)
        registry.delete(key)
      }
    }
  }, [intervalMs, module, packageId, suiClient])

  return events
}

export default useMoveModuleEvents
