"use client"

import type { TraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import { useMemo } from "react"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import type {
  TTraderAccountCardContent,
  TTraderAccountCardState,
  TTraderAccountCardViewModel,
  TTraderAccountDetails
} from "../types/TTraderAccountCard"
import useExplorerUrl from "./useExplorerUrl"
import type useResolvedTraderAccountId from "./useResolvedTraderAccountId"
import { type TraderAccountStatus } from "./useTraderAccountOverview"

const headerTitle = "AMM Executor"
const headerDescription =
  "Snapshot of the on-chain AMM executor for the connected wallet."
const missingWalletMessage = "Connect a wallet to load an AMM executor."
const missingConfigMessage =
  "Contract package id is not configured for this network."
const notFoundMessage = "No AMM executor found for the connected wallet."
const defaultLoadErrorMessage = "Unable to load AMM executor."

const buildTraderAccountDetails = (
  traderAccount: TraderAccountOverview
): TTraderAccountDetails => ({
  balanceManagerId: traderAccount.balanceManagerId,
  poolId: traderAccount.poolId
})

const resolveTraderAccountContent = ({
  status,
  traderAccount,
  error
}: {
  status: TraderAccountStatus
  traderAccount?: TraderAccountOverview
  error?: string
}): TTraderAccountCardContent => {
  if (status === "idle" || status === "loading") {
    return { state: "loading" }
  }

  if (status === "error") {
    return { state: "error", message: error ?? defaultLoadErrorMessage }
  }

  if (!traderAccount) {
    return { state: "error", message: defaultLoadErrorMessage }
  }

  return {
    state: "ready",
    details: buildTraderAccountDetails(traderAccount)
  }
}

const resolveTraderAccountCardContent = ({
  resolutionStatus,
  resolutionError,
  status,
  traderAccount,
  error
}: {
  resolutionStatus: ReturnType<typeof useResolvedTraderAccountId>["status"]
  resolutionError?: string
  status: TraderAccountStatus
  traderAccount?: TraderAccountOverview
  error?: string
}): TTraderAccountCardContent => {
  if (resolutionStatus === "wallet-required") {
    return { state: "missing-id", message: missingWalletMessage }
  }

  if (resolutionStatus === "missing-config") {
    return { state: "missing-id", message: missingConfigMessage }
  }

  if (resolutionStatus === "not-found") {
    return { state: "missing-id", message: notFoundMessage }
  }

  if (resolutionStatus === "error") {
    return {
      state: "error",
      message: resolutionError ?? defaultLoadErrorMessage
    }
  }

  if (resolutionStatus === "idle" || resolutionStatus === "loading") {
    return { state: "loading" }
  }

  return resolveTraderAccountContent({
    status,
    traderAccount,
    error
  })
}

const useTraderAccountCardViewModel = (): TTraderAccountCardState => {
  const explorerUrl = useExplorerUrl()
  const { resolution: traderAccountResolution, overview } =
    useTraderAccountContext()
  const traderAccountId = traderAccountResolution.traderAccountId
  const { status, traderAccount, error } = overview

  const content = useMemo(
    () =>
      resolveTraderAccountCardContent({
        resolutionStatus: traderAccountResolution.status,
        resolutionError: traderAccountResolution.error,
        status,
        traderAccount,
        error
      }),
    [
      traderAccountResolution.status,
      traderAccountResolution.error,
      status,
      traderAccount,
      error
    ]
  )

  const viewModel: TTraderAccountCardViewModel = {
    title: headerTitle,
    description: headerDescription,
    explorerUrl,
    traderAccountId,
    content
  }

  return { viewModel }
}

export default useTraderAccountCardViewModel
