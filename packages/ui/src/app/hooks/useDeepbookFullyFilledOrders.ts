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

type RawOrderFullyFilled = {
  pool_id?: string
  order_id?: string | number
  balance_manager_id?: string
}

const ORDER_FULLY_FILLED_TYPE_SUFFIX = "::order_info::OrderFullyFilled"

/**
 * Set of order IDs that DeepBook reported as `OrderFullyFilled` for the given
 * pool + BalanceManager. Used by Active Orders to mark a row as `FILLED`.
 *
 * Distinct from `useDeepbookOrderFills`, which surfaces every `OrderFilled`
 * event (including partial fills) for the Trade History table — a row stays
 * `OPEN` here until the order is fully consumed and removed from the book.
 */
export const useDeepbookFullyFilledOrders = ({
  poolId,
  balanceManagerId
}: {
  poolId?: string
  balanceManagerId?: string
}): Set<string> => {
  const { deepbookPackageId } = useDeploymentArtifacts()
  const rawEvents = useMoveModuleEvents({
    packageId: deepbookPackageId,
    module: "order_info"
  })

  return useMemo(() => {
    const normalizedPool = safeNormalize(poolId)
    const normalizedBm = safeNormalize(balanceManagerId)
    const ids = new Set<string>()
    if (!normalizedPool || !normalizedBm) return ids
    for (const event of rawEvents) {
      if (!event.type.endsWith(ORDER_FULLY_FILLED_TYPE_SUFFIX)) continue
      const data = event.parsedJson as RawOrderFullyFilled | undefined
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

export default useDeepbookFullyFilledOrders
