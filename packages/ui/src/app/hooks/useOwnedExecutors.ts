"use client"

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit"
import { useEffect, useState } from "react"
import {
  listOwnedAmmAdminCaps,
  type OwnedAmmAdminCap
} from "../helpers/ammAdminCap"
import useResolvedPackageId from "./useResolvedPackageId"

export type OwnedExecutorsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "wallet-required" }
  | { status: "missing-config" }
  | { status: "error"; error: string }
  | { status: "ready"; entries: OwnedAmmAdminCap[] }

/**
 * Lists every AMM `AdminCap` the connected wallet owns for the active
 * package, paired with the `executor_id` it controls. Drives the
 * executor-picker card on `/setup` so users with multiple executors can
 * switch between them. `refreshToken` lets callers force a re-fetch after
 * a create succeeds.
 */
const useOwnedExecutors = (refreshToken?: number): OwnedExecutorsState => {
  const suiClient = useSuiClient()
  const currentAccount = useCurrentAccount()
  const contractPackageId = useResolvedPackageId()
  const [state, setState] = useState<OwnedExecutorsState>({ status: "idle" })

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
        const entries = await listOwnedAmmAdminCaps({
          ownerAddress: currentAccount.address,
          packageId: contractPackageId,
          suiClient
        })
        if (!active) return
        setState({ status: "ready", entries })
      } catch (error) {
        if (!active) return
        setState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to load owned executors."
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

export default useOwnedExecutors
