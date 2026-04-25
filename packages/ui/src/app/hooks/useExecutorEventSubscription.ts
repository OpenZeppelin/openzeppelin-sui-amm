"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { useEffect } from "react"

const safeNormalize = (value?: string) => {
  if (!value) return undefined
  try {
    return normalizeSuiObjectId(value)
  } catch {
    return undefined
  }
}

/**
 * Subscribes to all events emitted by `packageId` and invokes `onEvent` when
 * an event's `executor_id` field matches `executorId`. Returns nothing; the
 * subscription is started on mount and torn down on unmount or when the
 * inputs change.
 *
 * Useful for keeping the local copy of the Executor's `Info` struct fresh —
 * any state-changing call (deposit, withdraw, refresh_quotes_permissionless, pause/unpause,
 * config update) emits an event that we can use as a signal to re-fetch.
 *
 * Errors during subscription setup (e.g. when the RPC endpoint doesn't
 * support WebSocket subscriptions) are logged and swallowed; callers still
 * have manual `refreshTraderAccount()` as a fallback.
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
  const suiClient = useSuiClient()

  useEffect(() => {
    if (!packageId || !executorId) return

    const normalizedExecutorId = safeNormalize(executorId)
    if (!normalizedExecutorId) return

    let cancelled = false
    let unsubscribeFn: (() => Promise<boolean>) | undefined

    const start = async () => {
      try {
        const fn = await suiClient.subscribeEvent({
          filter: { MoveEventModule: { package: packageId, module: "events" } },
          onMessage: (event) => {
            const parsed = event.parsedJson as
              | { executor_id?: string }
              | undefined
            const eventExecutorId = safeNormalize(parsed?.executor_id)
            if (eventExecutorId && eventExecutorId === normalizedExecutorId) {
              onEvent()
            }
          }
        })
        if (cancelled) {
          await fn()
          return
        }
        unsubscribeFn = fn
      } catch (error) {
        console.warn(
          "Executor event subscription failed; manual refresh remains available.",
          error
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      if (unsubscribeFn) void unsubscribeFn()
    }
  }, [executorId, onEvent, packageId, suiClient])
}

export default useExecutorEventSubscription
