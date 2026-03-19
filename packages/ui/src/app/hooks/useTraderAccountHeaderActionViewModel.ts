"use client"

import { useMemo } from "react"
import type { TTraderAccountCardHeaderAction } from "../types/TTraderAccountCard"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"

const useTraderAccountHeaderActionViewModel = () => {
  const { resolution, createAction } = useTraderAccountContext()

  return useMemo<TTraderAccountCardHeaderAction | undefined>(() => {
    const visible =
      resolution.status === "not-found" ||
      createAction.transactionState.status === "processing"

    if (!visible) return undefined

    return {
      label:
        createAction.transactionState.status === "processing"
          ? "Creating..."
          : "Create trader account",
      disabled: !createAction.canCreate,
      tooltip: createAction.disabledReason,
      onClick: () => {
        void createAction.createTraderAccount()
      }
    }
  }, [createAction, resolution.status])
}

export default useTraderAccountHeaderActionViewModel
