"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import type { SuiEvent } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { useEffect, useState } from "react"
import { LOCALNET_DEEPBOOK_PACKAGE_ID } from "../config/network"

const safeNormalize = (value?: string) => {
  if (!value) return undefined
  try {
    return normalizeSuiObjectId(value)
  } catch {
    return undefined
  }
}

const matchesPoolAndBalanceManager = ({
  event,
  poolId,
  balanceManagerId
}: {
  event: SuiEvent
  poolId: string
  balanceManagerId: string
}): boolean => {
  const data = event.parsedJson as
    | {
        pool_id?: string
        maker_balance_manager_id?: string
        taker_balance_manager_id?: string
      }
    | undefined
  if (!data) return false
  const eventPoolId = safeNormalize(data.pool_id)
  if (eventPoolId !== poolId) return false
  const makerBmId = safeNormalize(data.maker_balance_manager_id)
  const takerBmId = safeNormalize(data.taker_balance_manager_id)
  return makerBmId === balanceManagerId || takerBmId === balanceManagerId
}

const collectMatchingOrderIds = (
  data: { maker_order_id?: string; taker_order_id?: string } | undefined
) => {
  const ids: string[] = []
  if (data?.maker_order_id) ids.push(String(data.maker_order_id))
  if (data?.taker_order_id) ids.push(String(data.taker_order_id))
  return ids
}

/**
 * Tracks which of our order IDs have been (partially or fully) filled, by
 * subscribing to DeepBook's `OrderFilled` events for the given pool and
 * filtering against our BalanceManager.
 *
 * Returns a `Set<string>` of order IDs (decimal strings) that appeared as
 * either `maker_order_id` or `taker_order_id` in any matching fill event.
 *
 * Localnet only: uses `LOCALNET_DEEPBOOK_PACKAGE_ID` from `.env.local`. On
 * other networks the hook returns an empty set (and logs a warning).
 */
export const useDeepbookFillsForPool = ({
  poolId,
  balanceManagerId
}: {
  poolId?: string
  balanceManagerId?: string
}) => {
  const suiClient = useSuiClient()
  const [filledOrderIds, setFilledOrderIds] = useState<Set<string>>(
    () => new Set()
  )

  useEffect(() => {
    const deepbookPackageId = LOCALNET_DEEPBOOK_PACKAGE_ID
    if (!deepbookPackageId || !poolId || !balanceManagerId) {
      setFilledOrderIds(new Set())
      return
    }

    const normalizedPool = safeNormalize(poolId)
    const normalizedBm = safeNormalize(balanceManagerId)
    if (!normalizedPool || !normalizedBm) {
      setFilledOrderIds(new Set())
      return
    }

    let cancelled = false
    let unsubscribeFn: (() => Promise<boolean>) | undefined

    const ingest = (event: SuiEvent) => {
      if (
        !matchesPoolAndBalanceManager({
          event,
          poolId: normalizedPool,
          balanceManagerId: normalizedBm
        })
      ) {
        return
      }
      const ids = collectMatchingOrderIds(
        event.parsedJson as
          | { maker_order_id?: string; taker_order_id?: string }
          | undefined
      )
      if (ids.length === 0) return
      setFilledOrderIds((previous) => {
        let changed = false
        const next = new Set(previous)
        for (const id of ids) {
          if (!next.has(id)) {
            next.add(id)
            changed = true
          }
        }
        return changed ? next : previous
      })
    }

    const backfill = async () => {
      try {
        const result = await suiClient.queryEvents({
          query: {
            MoveEventModule: {
              package: deepbookPackageId,
              module: "order_info"
            }
          },
          limit: 200,
          order: "descending"
        })
        if (cancelled) return
        result.data.forEach(ingest)
      } catch (error) {
        console.warn("DeepBook fill backfill failed:", error)
      }
    }

    const startSubscription = async () => {
      try {
        const fn = await suiClient.subscribeEvent({
          filter: {
            MoveEventModule: {
              package: deepbookPackageId,
              module: "order_info"
            }
          },
          onMessage: (event) => {
            if (cancelled) return
            ingest(event)
          }
        })
        if (cancelled) {
          await fn()
          return
        }
        unsubscribeFn = fn
      } catch (error) {
        console.warn("DeepBook fill subscription failed:", error)
      }
    }

    void backfill()
    void startSubscription()

    return () => {
      cancelled = true
      if (unsubscribeFn) void unsubscribeFn()
    }
  }, [balanceManagerId, poolId, suiClient])

  return filledOrderIds
}

export default useDeepbookFillsForPool
