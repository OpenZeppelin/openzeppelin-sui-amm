"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import {
  getBalanceManagerAssetBalancesByBagId,
  type TraderAccountAssetBalance
} from "@sui-amm/domain-core/models/traderAccount"
import { useEffect, useState } from "react"

export type TraderAccountAssetBalancesStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"

type TraderAccountAssetBalancesState = {
  status: TraderAccountAssetBalancesStatus
  assetBalances?: TraderAccountAssetBalance[]
  error?: string
}

const emptyTraderAccountAssetBalancesState =
  (): TraderAccountAssetBalancesState => ({
    status: "idle"
  })

const resolveUnexpectedErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to load trader account balances."

const useTraderAccountAssetBalances = (
  balanceManagerBalancesBagId?: string,
  refreshToken?: number
): TraderAccountAssetBalancesState => {
  const suiClient = useSuiClient()
  const [state, setState] = useState<TraderAccountAssetBalancesState>(
    emptyTraderAccountAssetBalancesState()
  )

  useEffect(() => {
    let active = true

    if (!balanceManagerBalancesBagId) {
      setState(emptyTraderAccountAssetBalancesState())
      return () => {
        active = false
      }
    }

    setState({ status: "loading" })

    const load = async () => {
      try {
        const assetBalances = await getBalanceManagerAssetBalancesByBagId(
          balanceManagerBalancesBagId,
          suiClient
        )
        if (!active) return

        setState({
          status: "success",
          assetBalances
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
  }, [balanceManagerBalancesBagId, refreshToken, suiClient])

  return state
}

export default useTraderAccountAssetBalances
