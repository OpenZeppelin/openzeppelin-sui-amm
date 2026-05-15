"use client"

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

type RawOrderCanceled = {
  pool_id?: string
  order_id?: string | number
  balance_manager_id?: string
}

const ORDER_CANCELED_TYPE_SUFFIX = "::order::OrderCanceled"

/**
 * Set of order IDs that DeepBook reported as `OrderCanceled` for the given
 * pool + BalanceManager. Used by Active Orders to mark a row as `CANCELLED`
 * when the executor cancels the ladder out of band of a fresh `QuoteUpdated`
 * (e.g. via `cancel_orders_after_update` following an `update_config`, or via
 * `pause`).
 *
 * Mirrors `useDeepbookFullyFilledOrders`; both filter the same on-chain
 * BalanceManager + pool, just on different DeepBook event types.
 */
export const useDeepbookCanceledOrders = ({
  poolId,
  balanceManagerId
}: {
  poolId?: string
  balanceManagerId?: string
}): Set<string> => {
  const { deepbookPackageId } = useDeploymentArtifacts()
  const rawEvents = useMoveModuleEvents({
    packageId: deepbookPackageId,
    module: "order"
  })

  return useMemo(() => {
    const normalizedPool = safeNormalize(poolId)
    const normalizedBm = safeNormalize(balanceManagerId)
    const ids = new Set<string>()
    if (!normalizedPool || !normalizedBm) return ids
    for (const event of rawEvents) {
      if (!event.type.endsWith(ORDER_CANCELED_TYPE_SUFFIX)) continue
      const data = event.parsedJson as RawOrderCanceled | undefined
      if (!data) continue
      if (safeNormalize(data.pool_id) !== normalizedPool) continue
      if (safeNormalize(data.balance_manager_id) !== normalizedBm) continue
      const orderId = data.order_id
      if (orderId === undefined || orderId === null) continue
      ids.add(String(orderId))
    }
    return ids
  }, [balanceManagerId, poolId, rawEvents])
}

export default useDeepbookCanceledOrders
