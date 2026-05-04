"use client"

import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { useEffect, useState } from "react"
import {
  useDeepbookOrderFills,
  type DeepbookOrderFill
} from "./useDeepbookOrderFills"

// Bounded ceiling on accumulated fills per (pool, BalanceManager). Keeps the
// in-memory store small even after a long trading session — the Trade
// History card displays at most 100, so 500 leaves comfortable headroom.
const MAX_ACCUMULATED_FILLS = 500

// localStorage namespace for the accumulator so a browser reload (F5) keeps
// older fills around — same UX the Event Feed gives "for free" because the
// AMM `events` module is sparse enough that 500 chain events cover plenty of
// history. The deepbook `order_info` module is busier, so we explicitly
// persist what we've seen.
const STORAGE_KEY_PREFIX = "sui-amm:trade-history:"

const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined"

const readPersisted = (key: string): DeepbookOrderFill[] => {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DeepbookOrderFill[]) : []
  } catch {
    return []
  }
}

const writePersisted = (key: string, fills: DeepbookOrderFill[]) => {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(
      STORAGE_KEY_PREFIX + key,
      JSON.stringify(fills)
    )
  } catch {
    // Ignore quota / privacy-mode errors — the in-memory store still works.
  }
}

const safeNormalize = (value?: string) => {
  if (!value) return undefined
  try {
    return normalizeSuiObjectId(value)
  } catch {
    return undefined
  }
}

const buildKey = (poolId: string, balanceManagerId: string) =>
  `${poolId}|${balanceManagerId}`

type StoreEntry = {
  fillsById: Map<string, DeepbookOrderFill>
  // Sorted snapshot the hooks subscribe to. Recomputed on each mutation;
  // returning a stable array reference avoids triggering useEffect deps in
  // consumers when nothing changed.
  sortedFills: DeepbookOrderFill[]
  subscribers: Set<(fills: DeepbookOrderFill[]) => void>
}

// Module-scoped store keyed by (pool, BalanceManager). Survives component
// unmount/remount (e.g., navigating between terminal pages) so the Trade
// History table doesn't reset every time the user clicks a sidebar link.
const store = new Map<string, StoreEntry>()

const getOrCreateEntry = (key: string): StoreEntry => {
  let entry = store.get(key)
  if (!entry) {
    // Hydrate from localStorage so a browser reload doesn't reset the table.
    const persisted = readPersisted(key)
    const fillsById = new Map<string, DeepbookOrderFill>()
    for (const fill of persisted) fillsById.set(fill.eventId, fill)
    entry = {
      fillsById,
      sortedFills: sortAndCap([...fillsById.values()]),
      subscribers: new Set()
    }
    store.set(key, entry)
  }
  return entry
}

const sortAndCap = (fills: DeepbookOrderFill[]): DeepbookOrderFill[] => {
  const sorted = [...fills].sort((a, b) => {
    const aTs = a.timestampMs ?? 0
    const bTs = b.timestampMs ?? 0
    return bTs - aTs
  })
  return sorted.length > MAX_ACCUMULATED_FILLS
    ? sorted.slice(0, MAX_ACCUMULATED_FILLS)
    : sorted
}

const ingestBatch = (key: string, batch: DeepbookOrderFill[]) => {
  const entry = getOrCreateEntry(key)
  let changed = false
  for (const fill of batch) {
    if (entry.fillsById.has(fill.eventId)) continue
    entry.fillsById.set(fill.eventId, fill)
    changed = true
  }
  if (!changed) return
  // Re-sort once per ingest so subscribers always see newest-first regardless
  // of arrival order across polls.
  entry.sortedFills = sortAndCap([...entry.fillsById.values()])
  // Drop entries beyond the cap from the lookup map too, so the in-memory
  // footprint matches the visible list.
  if (entry.fillsById.size > MAX_ACCUMULATED_FILLS) {
    const keep = new Set(entry.sortedFills.map((fill) => fill.eventId))
    for (const id of entry.fillsById.keys()) {
      if (!keep.has(id)) entry.fillsById.delete(id)
    }
  }
  // Persist after each ingest so a reload picks up exactly what was last
  // observed. Cheap: ~500 fills × ~250 bytes = ~125 KB of JSON, written at
  // most once per poll tick.
  writePersisted(key, entry.sortedFills)
  for (const subscriber of entry.subscribers) subscriber(entry.sortedFills)
}

/**
 * Same shape as `useDeepbookOrderFills`, but the returned list is built up
 * across polls and persisted in a module-level store keyed by
 * `(poolId, balanceManagerId)`. New `OrderFilled` events are merged in;
 * older ones stick until they're displaced beyond `MAX_ACCUMULATED_FILLS`.
 *
 * Why: the underlying poller only surfaces the most-recent 500 events from
 * the deepbook `order_info` module, so on a busy chain our older fills get
 * pushed off the live window and disappear. Accumulating in module scope
 * means navigating between terminal pages — or simply waiting through more
 * deepbook activity — doesn't wipe the Trade History table.
 */
export const useAccumulatedDeepbookOrderFills = ({
  poolId,
  balanceManagerId
}: {
  poolId?: string
  balanceManagerId?: string
}): DeepbookOrderFill[] => {
  const liveFills = useDeepbookOrderFills({ poolId, balanceManagerId })
  const normalizedPool = safeNormalize(poolId)
  const normalizedBm = safeNormalize(balanceManagerId)
  const key =
    normalizedPool && normalizedBm
      ? buildKey(normalizedPool, normalizedBm)
      : undefined

  // Track the latest ingested snapshot for this (pool, BM). Uses a stable
  // ref via the module store so a remount picks up the cached list
  // synchronously instead of starting from an empty array.
  const initial = key ? (store.get(key)?.sortedFills ?? []) : []
  const [snapshot, setSnapshot] = useState<DeepbookOrderFill[]>(initial)

  useEffect(() => {
    if (!key) {
      setSnapshot([])
      return
    }
    const entry = getOrCreateEntry(key)
    setSnapshot(entry.sortedFills)
    const subscriber = (next: DeepbookOrderFill[]) => setSnapshot(next)
    entry.subscribers.add(subscriber)
    return () => {
      entry.subscribers.delete(subscriber)
    }
  }, [key])

  // Funnel each new live batch into the store. The store dedupes by eventId
  // so re-ingesting the same batch on every render is cheap.
  useEffect(() => {
    if (!key || liveFills.length === 0) return
    ingestBatch(key, liveFills)
  }, [key, liveFills])

  return snapshot
}

export default useAccumulatedDeepbookOrderFills
