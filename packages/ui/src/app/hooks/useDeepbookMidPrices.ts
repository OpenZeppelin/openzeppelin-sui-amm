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

// DeepBook exposes only the *current* book mid (`pool::mid_price`), not a
// historical price feed, so the only honest sample we can take is right now.
// Restrict backfill to events whose on-chain timestamp is within this window of
// fetch time — older events stay uncached and render as gaps, instead of every
// historical point getting clamped to today's mid and producing a misleading
// horizontal stretch on the chart.
const FRESH_EVENT_WINDOW_MS = 30_000

const PROBE_SENDER =
  "0x0000000000000000000000000000000000000000000000000000000000000001"

// localStorage namespace so the per-event mid map survives a browser reload
// or a navigation away from /dashboard. Without persistence the chart's
// DeepBook line would collapse to "only points fetched since this mount",
// which on a freshly-opened page is just the latest QuoteUpdated event.
const STORAGE_KEY_PREFIX = "sui-amm:deepbook-mid:"

const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined"

// Persisted shape: `bigint` values are written as `{ kind: "bigint", value }`
// since BigInt isn't natively JSON-serializable. The "error" sentinel rides
// along as a plain string.
type SerializedMidEntry = { kind: "bigint"; value: string } | { kind: "error" }

const serializeEntry = (entry: DeepbookMidEntry): SerializedMidEntry =>
  entry === "error"
    ? { kind: "error" }
    : { kind: "bigint", value: entry.toString() }

const deserializeEntry = (entry: SerializedMidEntry): DeepbookMidEntry =>
  entry.kind === "error" ? "error" : BigInt(entry.value)

const readPersisted = (key: string): Map<string, DeepbookMidEntry> => {
  const map = new Map<string, DeepbookMidEntry>()
  if (!isBrowser()) return map
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + key)
    if (!raw) return map
    const parsed = JSON.parse(raw) as Record<string, SerializedMidEntry>
    for (const [id, entry] of Object.entries(parsed)) {
      try {
        map.set(id, deserializeEntry(entry))
      } catch {
        // Drop malformed entries silently.
      }
    }
  } catch {
    // Ignore corrupt storage payloads.
  }
  return map
}

const writePersisted = (key: string, map: Map<string, DeepbookMidEntry>) => {
  if (!isBrowser()) return
  try {
    const payload: Record<string, SerializedMidEntry> = {}
    for (const [id, entry] of map.entries()) {
      payload[id] = serializeEntry(entry)
    }
    window.localStorage.setItem(
      STORAGE_KEY_PREFIX + key,
      JSON.stringify(payload)
    )
  } catch {
    // Quota / privacy errors are recoverable — in-memory map still works.
  }
}

type StoreEntry = {
  byEventId: Map<string, DeepbookMidEntry>
  subscribers: Set<(map: Map<string, DeepbookMidEntry>) => void>
  inFlight: Set<string>
}

// Module-scoped store keyed by `(pool, base, quote)` so the mid map outlives
// page-navigation unmounts. Hydrated from localStorage on first access.
const store = new Map<string, StoreEntry>()

const buildKey = (
  poolId: string,
  baseCoinType: string,
  quoteCoinType: string
) => `${poolId}|${baseCoinType}|${quoteCoinType}`

const getOrCreateEntry = (key: string): StoreEntry => {
  let entry = store.get(key)
  if (!entry) {
    entry = {
      byEventId: readPersisted(key),
      subscribers: new Set(),
      inFlight: new Set()
    }
    store.set(key, entry)
  }
  return entry
}

const ingestEntries = (
  key: string,
  entries: ReadonlyArray<readonly [string, DeepbookMidEntry]>
) => {
  if (entries.length === 0) return
  const entry = getOrCreateEntry(key)
  let changed = false
  for (const [id, value] of entries) {
    if (entry.byEventId.has(id)) continue
    entry.byEventId.set(id, value)
    changed = true
  }
  if (!changed) return
  writePersisted(key, entry.byEventId)
  // Snapshot is a fresh Map ref so React re-renders.
  const snapshot = new Map(entry.byEventId)
  for (const subscriber of entry.subscribers) subscriber(snapshot)
}

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
 * one-call dev-inspect. Results are cached per `(pool, base, quote)` event
 * id in a module-scoped store and mirrored to localStorage so a page
 * reload — or navigating between terminal pages — keeps the previously-
 * sampled mids on the chart.
 *
 * Aborts (one-sided book) are recorded as `"error"` so the chart can skip
 * the point with a gap instead of a zero spike.
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
  const ready =
    Boolean(deepbookPackageId) &&
    Boolean(poolId) &&
    Boolean(baseCoinType) &&
    Boolean(quoteCoinType)
  const key =
    ready && deepbookPackageId && poolId && baseCoinType && quoteCoinType
      ? buildKey(poolId, baseCoinType, quoteCoinType)
      : undefined

  const initial = key
    ? new Map(getOrCreateEntry(key).byEventId)
    : new Map<string, DeepbookMidEntry>()
  const [byEventId, setByEventId] =
    useState<Map<string, DeepbookMidEntry>>(initial)
  // Tracks the latest store key the hook is wired to so the subscription
  // effect's cleanup unsubscribes from the right entry even if the key
  // changes mid-mount (executor / pool switch).
  const subscribedKeyRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!key) {
      setByEventId(new Map())
      subscribedKeyRef.current = undefined
      return
    }
    const entry = getOrCreateEntry(key)
    setByEventId(new Map(entry.byEventId))
    const subscriber = (next: Map<string, DeepbookMidEntry>) =>
      setByEventId(next)
    entry.subscribers.add(subscriber)
    subscribedKeyRef.current = key
    return () => {
      entry.subscribers.delete(subscriber)
    }
  }, [key])

  useEffect(() => {
    if (
      !key ||
      !deepbookPackageId ||
      !poolId ||
      !baseCoinType ||
      !quoteCoinType
    ) {
      return
    }
    const entry = getOrCreateEntry(key)
    const freshnessCutoffMs = Date.now() - FRESH_EVENT_WINDOW_MS
    const pending = events.filter(
      (event) =>
        event.type === "QuoteUpdated" &&
        !entry.byEventId.has(event.id) &&
        !entry.inFlight.has(event.id) &&
        event.timestampMs !== null &&
        event.timestampMs >= freshnessCutoffMs
    )
    if (pending.length === 0) return

    pending.forEach((event) => entry.inFlight.add(event.id))

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
    )
      .then((results) => {
        if (cancelled) return
        ingestEntries(key, results)
      })
      .finally(() => {
        // Always release in-flight slots — on success, cancellation, and
        // rejection — otherwise those event ids would be filtered out by the
        // dedupe guard forever.
        pending.forEach((event) => entry.inFlight.delete(event.id))
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
    key
  ])

  return byEventId
}

export type { DeepbookMidEntry }
