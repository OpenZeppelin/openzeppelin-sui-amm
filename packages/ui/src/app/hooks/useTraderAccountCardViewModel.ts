"use client"

import type { TraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import { useMemo } from "react"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import type {
  TTraderAccountAssetBalancesContent,
  TTraderAccountCardContent,
  TTraderAccountCardState,
  TTraderAccountCardViewModel,
  TTraderAccountDetails
} from "../types/TTraderAccountCard"
import useExplorerUrl from "./useExplorerUrl"
import type useResolvedTraderAccountId from "./useResolvedTraderAccountId"
import useTraderAccountAssetBalances from "./useTraderAccountAssetBalances"
import { type TraderAccountStatus } from "./useTraderAccountOverview"

const headerTitle = "Trader account"
const headerDescription =
  "Snapshot of the on-chain trader account for the connected wallet."
const missingWalletMessage = "Connect a wallet to load a trader account."
const missingConfigMessage =
  "Contract package id is not configured for this network."
const notFoundMessage = "No trader account found for the connected wallet."
const defaultLoadErrorMessage = "Unable to load trader account."
const defaultBalanceLoadErrorMessage = "Unable to load balance manager assets."

const resolveAssetBalancesContent = ({
  status,
  assetBalances,
  error
}: ReturnType<
  typeof useTraderAccountAssetBalances
>): TTraderAccountAssetBalancesContent => {
  if (status === "idle" || status === "loading") {
    return { state: "loading" }
  }

  if (status === "error") {
    return {
      state: "error",
      message: error ?? defaultBalanceLoadErrorMessage
    }
  }

  return {
    state: "ready",
    balances: (assetBalances ?? []).map((assetBalance) => ({
      coinType: assetBalance.coinType,
      balance: assetBalance.balance.toString()
    }))
  }
}

const buildTraderAccountDetails = (
  traderAccount: TraderAccountOverview,
  assetBalances: ReturnType<typeof useTraderAccountAssetBalances>
): TTraderAccountDetails => ({
  ownerAddress: traderAccount.ownerAddress,
  balanceManagerId: traderAccount.balanceManagerId,
  tradeCapId: traderAccount.tradeCapId,
  depositCapId: traderAccount.depositCapId,
  withdrawCapId: traderAccount.withdrawCapId,
  activeOrdersTableId: traderAccount.activeOrdersTableId,
  assetBalances: resolveAssetBalancesContent(assetBalances)
})

const resolveTraderAccountContent = ({
  status,
  traderAccount,
  error,
  assetBalances
}: {
  status: TraderAccountStatus
  traderAccount?: TraderAccountOverview
  error?: string
  assetBalances: ReturnType<typeof useTraderAccountAssetBalances>
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
    details: buildTraderAccountDetails(traderAccount, assetBalances)
  }
}

const resolveTraderAccountCardContent = ({
  resolutionStatus,
  resolutionError,
  status,
  traderAccount,
  error,
  assetBalances
}: {
  resolutionStatus: ReturnType<typeof useResolvedTraderAccountId>["status"]
  resolutionError?: string
  status: TraderAccountStatus
  traderAccount?: TraderAccountOverview
  error?: string
  assetBalances: ReturnType<typeof useTraderAccountAssetBalances>
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
    error,
    assetBalances
  })
}

const useTraderAccountCardViewModel = (): TTraderAccountCardState => {
  const explorerUrl = useExplorerUrl()
  const {
    resolution: traderAccountResolution,
    overview,
    refreshVersion
  } = useTraderAccountContext()
  const traderAccountBalances = useTraderAccountAssetBalances(
    overview.traderAccount?.balanceManagerId,
    refreshVersion
  )
  const traderAccountId = traderAccountResolution.traderAccountId
  const { status, traderAccount, error } = overview

  const content = useMemo(
    () =>
      resolveTraderAccountCardContent({
        resolutionStatus: traderAccountResolution.status,
        resolutionError: traderAccountResolution.error,
        status,
        traderAccount,
        error,
        assetBalances: traderAccountBalances
      }),
    [
      traderAccountResolution.status,
      traderAccountResolution.error,
      status,
      traderAccount,
      error,
      traderAccountBalances
    ]
  )

  const viewModel: TTraderAccountCardViewModel = {
    title: headerTitle,
    description: headerDescription,
    explorerUrl,
    traderAccountId,
    content,
    headerAction
  }

  return { viewModel }
}

export default useTraderAccountCardViewModel
