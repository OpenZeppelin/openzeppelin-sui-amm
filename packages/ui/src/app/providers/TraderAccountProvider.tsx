"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react"
import useExecutorEventSubscription from "../hooks/useExecutorEventSubscription"
import useResolvedPackageId from "../hooks/useResolvedPackageId"
import useResolvedTraderAccountId from "../hooks/useResolvedTraderAccountId"
import useTraderAccountOverview from "../hooks/useTraderAccountOverview"

type TraderAccountContextValue = {
  resolution: ReturnType<typeof useResolvedTraderAccountId>
  overview: ReturnType<typeof useTraderAccountOverview>
  refreshTraderAccount: () => void
}

const TraderAccountContext = createContext<
  TraderAccountContextValue | undefined
>(undefined)

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
  const packageId = useResolvedPackageId()

  // Re-fetch the executor whenever it emits an event (deposit/withdraw/
  // refresh_quotes/etc.). Falls back silently when the RPC doesn't support
  // WebSocket subscriptions.
  useExecutorEventSubscription({
    packageId,
    executorId: resolution.traderAccountId,
    onEvent: refreshTraderAccount
  })

  const value = useMemo(
    () => ({
      resolution,
      overview,
      refreshTraderAccount
    }),
    [overview, refreshTraderAccount, resolution]
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
