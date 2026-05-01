"use client"

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit"
import { useEffect, useState } from "react"
import { resolveAmmAdminCap } from "../helpers/ammAdminCap"
import {
  readSelectedAdminCapId,
  subscribeToSelectedAdminCapIdChanges
} from "../helpers/selectedAdminCap"
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
  adminCapId?: string
  error?: string
}

const emptyResolutionState = (): TraderAccountIdResolutionState => ({
  status: "idle"
})

const resolveUnexpectedErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to resolve market maker."

const useResolvedTraderAccountId = (
  refreshToken?: number
): TraderAccountIdResolutionState => {
  const suiClient = useSuiClient()
  const currentAccount = useCurrentAccount()
  const contractPackageId = useResolvedPackageId()
  const [state, setState] = useState<TraderAccountIdResolutionState>(
    emptyResolutionState()
  )
  // Bumped whenever the user picks a different executor on /setup so the
  // resolver re-runs and the rest of the terminal swaps over without a reload.
  const [selectionToken, setSelectionToken] = useState(0)

  useEffect(() => {
    return subscribeToSelectedAdminCapIdChanges(() => {
      setSelectionToken((value) => value + 1)
    })
  }, [])

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
        const preferredAdminCapId = readSelectedAdminCapId()
        const owned = await resolveAmmAdminCap({
          ownerAddress: currentAccount.address,
          packageId: contractPackageId,
          preferredAdminCapId,
          suiClient
        })
        if (!active) return
        if (!owned) {
          setState({ status: "not-found" })
          return
        }

        setState({
          status: "ready",
          traderAccountId: owned.executorId,
          adminCapId: owned.adminCapId
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
  }, [
    contractPackageId,
    currentAccount?.address,
    refreshToken,
    selectionToken,
    suiClient
  ])

  return state
}

export default useResolvedTraderAccountId
