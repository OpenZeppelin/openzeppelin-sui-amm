"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import {
  getTraderAccountOverview,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import { useEffect, useState } from "react"
import useResolvedPackageId from "./useResolvedPackageId"

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
  error instanceof Error ? error.message : "Unable to load market maker."

const useTraderAccountOverview = (
  traderAccountId?: string,
  refreshToken?: number
) => {
  const suiClient = useSuiClient()
  const ammPackageId = useResolvedPackageId()
  const [state, setState] = useState<TraderAccountState>(
    emptyTraderAccountState()
  )

  useEffect(() => {
    let active = true

    if (!traderAccountId || !ammPackageId) {
      setState(emptyTraderAccountState())
      return () => {
        active = false
      }
    }

    // Only flash the `loading` state on the FIRST fetch. On subsequent
    // refreshes (driven by QuoteUpdated/Deposited/etc.) keep the previous
    // `success` snapshot visible so consumer pages don't unmount their
    // content — the Performance page's `status === "loading" → <Loading />`
    // guard would otherwise wipe scroll position and component state on
    // every refresh.
    setState((previous) =>
      previous.status === "success" ? previous : { status: "loading" }
    )

    const load = async () => {
      try {
        const traderAccount = await getTraderAccountOverview(
          traderAccountId,
          suiClient,
          ammPackageId
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
  }, [ammPackageId, refreshToken, traderAccountId, suiClient])

  return state
}

export default useTraderAccountOverview
