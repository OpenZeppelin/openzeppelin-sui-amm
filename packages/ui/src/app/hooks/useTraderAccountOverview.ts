"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import {
  getTraderAccountOverview,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import { useEffect, useState } from "react"

export type TraderAccountStatus = "idle" | "loading" | "success" | "error"

type TraderAccountState = {
  status: TraderAccountStatus
  traderAccount?: TraderAccountOverview
  error?: string
}

const emptyTraderAccountState = (): TraderAccountState => ({
  status: "idle"
})

const resolveUnexpectedErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to load trader account."

const useTraderAccountOverview = (traderAccountId?: string) => {
  const suiClient = useSuiClient()
  const [state, setState] = useState<TraderAccountState>(
    emptyTraderAccountState()
  )

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

        setState({
          status: "success",
          traderAccount
        })
      } catch (error) {
        if (!active) return

        setState({
          status: "error",
          error: resolveUnexpectedErrorMessage(error)
        })
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [traderAccountId, suiClient])

  return state
}

export default useTraderAccountOverview
