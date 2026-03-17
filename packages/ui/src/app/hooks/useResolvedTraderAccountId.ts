"use client"

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit"
import { findOwnedTraderAccountIds } from "@sui-amm/domain-core/models/traderAccount"
import { useEffect, useState } from "react"
import useResolvedPackageId from "./useResolvedPackageId"

export type TraderAccountIdResolutionStatus =
  | "idle"
  | "loading"
  | "ready"
  | "wallet-required"
  | "missing-config"
  | "not-found"
  | "error"

type TraderAccountIdResolutionState = {
  status: TraderAccountIdResolutionStatus
  traderAccountId?: string
  error?: string
}

const emptyResolutionState = (): TraderAccountIdResolutionState => ({
  status: "idle"
})

const pickTraderAccountId = (traderAccountIds: string[]) => traderAccountIds[0]

const resolveUnexpectedErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to resolve trader account."

const useResolvedTraderAccountId = (
  refreshToken?: number
): TraderAccountIdResolutionState => {
  const suiClient = useSuiClient()
  const currentAccount = useCurrentAccount()
  const contractPackageId = useResolvedPackageId()
  const [state, setState] = useState<TraderAccountIdResolutionState>(
    emptyResolutionState()
  )

  useEffect(() => {
    let active = true

    if (!currentAccount?.address) {
      setState({ status: "wallet-required" })
      return () => {
        active = false
      }
    }

    if (!contractPackageId) {
      setState({ status: "missing-config" })
      return () => {
        active = false
      }
    }

    setState({ status: "loading" })

    const load = async () => {
      try {
        const traderAccountIds = await findOwnedTraderAccountIds({
          ownerAddress: currentAccount.address,
          packageId: contractPackageId,
          suiClient
        })
        if (!active) return

        const traderAccountId = pickTraderAccountId(traderAccountIds)
        if (!traderAccountId) {
          setState({ status: "not-found" })
          return
        }

        setState({
          status: "ready",
          traderAccountId
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
  }, [contractPackageId, currentAccount?.address, refreshToken, suiClient])

  return state
}

export default useResolvedTraderAccountId
