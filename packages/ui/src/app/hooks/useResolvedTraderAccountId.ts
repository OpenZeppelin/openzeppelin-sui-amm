"use client"

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit"
import { useEffect, useState } from "react"
import { findOwnedTraderAccountId } from "@sui-amm/domain-core/models/traderAccount"
import useResolvedContractPackageId from "./useResolvedContractPackageId"

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

const useResolvedTraderAccountId = (): TraderAccountIdResolutionState => {
  const suiClient = useSuiClient()
  const currentAccount = useCurrentAccount()
  const contractPackageId = useResolvedContractPackageId()
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
        const traderAccountId = await findOwnedTraderAccountId({
          ownerAddress: currentAccount.address,
          packageId: contractPackageId,
          suiClient
        })

        if (!active) return

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
          error:
            error instanceof Error
              ? error.message
              : "Unable to resolve trader account."
        })
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [contractPackageId, currentAccount?.address, suiClient])

  return state
}

export default useResolvedTraderAccountId
