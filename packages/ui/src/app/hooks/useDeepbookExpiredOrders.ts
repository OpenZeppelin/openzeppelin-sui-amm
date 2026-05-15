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

type RawOrderExpired = {
  pool_id?: string
  order_id?: string | number
  balance_manager_id?: string
}

const ORDER_EXPIRED_TYPE_SUFFIX = "::order_info::OrderExpired"

/**
 * Set of order IDs that DeepBook reported as `OrderExpired` for the given
 * pool + BalanceManager. Used by Active Orders to mark a row as `EXPIRED`
 * when DeepBook removes an order whose `expire_timestamp` has passed during
 * a subsequent matching or cancel traversal.
 */
export const useDeepbookExpiredOrders = ({
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
      if (!event.type.endsWith(ORDER_EXPIRED_TYPE_SUFFIX)) continue
      const data = event.parsedJson as RawOrderExpired | undefined
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

export default useDeepbookExpiredOrders
