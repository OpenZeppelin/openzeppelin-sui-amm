"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import {
  getTraderAccountOverview,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import { useCallback, useEffect, useState } from "react"

export type TraderAccountStatus = "idle" | "loading" | "success" | "error"

type TraderAccountState = {
  status: TraderAccountStatus
  traderAccount?: TraderAccountOverview
  error?: string
}

const emptyTraderAccountState = (): TraderAccountState => ({
  status: "idle"
})

const useTraderAccountOverview = (traderAccountId?: string) => {
  const suiClient = useSuiClient()
  const [state, setState] = useState<TraderAccountState>(
    emptyTraderAccountState()
  )
  const [refreshIndex, setRefreshIndex] = useState(0)

  const refreshTraderAccount = useCallback(() => {
    setRefreshIndex((previous) => previous + 1)
  }, [])

  useEffect(() => {
    let active = true

    if (!traderAccountId) {
      setState(emptyTraderAccountState())
      return () => {
        active = false
      }
    }

    setState({ status: "loading" })

    const load = async () => {
      try {
        const traderAccount = await getTraderAccountOverview(
          traderAccountId,
          suiClient
        )
        if (!active) return
        setState({ status: "success", traderAccount })
      } catch (error) {
        if (!active) return
        setState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to load trader account."
        })
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [traderAccountId, refreshIndex, suiClient])

  return {
    status: state.status,
    traderAccount: state.traderAccount,
    error: state.error,
    refreshTraderAccount
  }
}

export default useTraderAccountOverview
