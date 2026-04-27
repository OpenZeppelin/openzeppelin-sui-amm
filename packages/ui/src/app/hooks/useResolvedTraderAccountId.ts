"use client"

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit"
import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { useEffect, useState } from "react"
import { resolveAmmAdminCapId } from "../helpers/ammAdminCap"
import useResolvedPackageId from "./useResolvedPackageId"

const readExecutorIdFromAdminCap = async ({
  adminCapId,
  suiClient
}: {
  adminCapId: string
  suiClient: SuiClient
}): Promise<string | undefined> => {
  const response = await suiClient.getObject({
    id: adminCapId,
    options: { showContent: true }
  })
  const content = response.data?.content
  if (!content || content.dataType !== "moveObject") return undefined
  const fields = (content as { fields?: { executor_id?: unknown } }).fields
  const raw = fields?.executor_id
  if (typeof raw === "string") return normalizeSuiObjectId(raw)
  return undefined
}

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
        const adminCapId = await resolveAmmAdminCapId({
          ownerAddress: currentAccount.address,
          packageId: contractPackageId,
          suiClient
        })
        if (!active) return
        if (!adminCapId) {
          setState({ status: "not-found" })
          return
        }

        const traderAccountId = await readExecutorIdFromAdminCap({
          adminCapId,
          suiClient
        })
        if (!active) return
        if (!traderAccountId) {
          setState({
            status: "error",
            error:
              "Found an AdminCap but could not read its executor_id. Try refreshing."
          })
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
