"use client"

import type { TraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import { useMemo } from "react"
import type {
  TTraderAccountCardContent,
  TTraderAccountCardState,
  TTraderAccountCardViewModel,
  TTraderAccountDetails
} from "../types/TTraderAccountCard"
import useExplorerUrl from "./useExplorerUrl"
import useResolvedTraderAccountId from "./useResolvedTraderAccountId"
import useTraderAccountOverview, {
  type TraderAccountStatus
} from "./useTraderAccountOverview"

const headerTitle = "Trader account"
const headerDescription =
  "Snapshot of the on-chain trader account for the connected wallet."
const missingWalletMessage = "Connect a wallet to load a trader account."
const missingConfigMessage =
  "Contract package id is not configured for this network."
const notFoundMessage = "No trader account found for the connected wallet."
const defaultLoadErrorMessage = "Unable to load trader account."

const buildTraderAccountDetails = (
  traderAccount: TraderAccountOverview
): TTraderAccountDetails => ({
  ownerAddress: traderAccount.ownerAddress,
  balanceManagerId: traderAccount.balanceManagerId,
  tradeCapId: traderAccount.tradeCapId,
  depositCapId: traderAccount.depositCapId,
  withdrawCapId: traderAccount.withdrawCapId,
  activeOrdersTableId: traderAccount.activeOrdersTableId
})

const resolveContentState = ({
  status,
  traderAccount,
  error
}: {
  traderAccountId?: string
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

  return { state: "ready", details: buildTraderAccountDetails(traderAccount) }
}

const resolveTraderAccountCardContent = ({
  resolutionStatus,
  resolutionError,
  traderAccountId,
  status,
  traderAccount,
  error
}: {
  resolutionStatus: ReturnType<typeof useResolvedTraderAccountId>["status"]
  resolutionError?: string
  traderAccountId?: string
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

  return resolveContentState({
    traderAccountId,
    status,
    traderAccount,
    error
  })
}

const useTraderAccountCardViewModel = (): TTraderAccountCardState => {
  const explorerUrl = useExplorerUrl()
  const traderAccountResolution = useResolvedTraderAccountId()
  const traderAccountId = traderAccountResolution.traderAccountId
  const { status, traderAccount, error } =
    useTraderAccountOverview(traderAccountId)

  const content = useMemo(
    () =>
      resolveTraderAccountCardContent({
        resolutionStatus: traderAccountResolution.status,
        resolutionError: traderAccountResolution.error,
        traderAccountId,
        status,
        traderAccount,
        error
      }),
    [
      traderAccountResolution.status,
      traderAccountResolution.error,
      traderAccountId,
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
