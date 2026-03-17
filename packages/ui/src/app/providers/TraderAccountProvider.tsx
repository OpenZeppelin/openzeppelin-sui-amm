"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import useCreateTraderAccountAction from "../hooks/useCreateTraderAccountAction"
import useResolvedTraderAccountId from "../hooks/useResolvedTraderAccountId"
import useTraderAccountOverview from "../hooks/useTraderAccountOverview"

type TraderAccountContextValue = {
  resolution: ReturnType<typeof useResolvedTraderAccountId>
  overview: ReturnType<typeof useTraderAccountOverview>
  createAction: ReturnType<typeof useCreateTraderAccountAction>
  refreshTraderAccount: () => void
}

const TraderAccountContext =
  createContext<TraderAccountContextValue | undefined>(undefined)

export const TraderAccountProvider = ({
  children
}: {
  children: ReactNode
}) => {
  const [refreshToken, setRefreshToken] = useState(0)
  const refreshTraderAccount = useCallback(() => {
    setRefreshToken((currentValue) => currentValue + 1)
  }, [])

  const resolution = useResolvedTraderAccountId(refreshToken)
  const overview = useTraderAccountOverview(
    resolution.traderAccountId,
    refreshToken
  )
  const createAction = useCreateTraderAccountAction({
    onCreated: refreshTraderAccount
  })

  const value = useMemo(
    () => ({
      resolution,
      overview,
      createAction,
      refreshTraderAccount
    }),
    [createAction, overview, refreshTraderAccount, resolution]
  )

  return (
    <TraderAccountContext.Provider value={value}>
      {children}
    </TraderAccountContext.Provider>
  )
}

export const useTraderAccountContext = () => {
  const context = useContext(TraderAccountContext)

  if (!context) {
    throw new Error(
      "useTraderAccountContext must be used within a TraderAccountProvider."
    )
  }

  return context
}