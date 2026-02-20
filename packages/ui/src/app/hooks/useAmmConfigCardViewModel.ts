"use client"

import { useSuiClientContext } from "@mysten/dapp-kit"
import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import { useMemo } from "react"
import { formatNetworkType } from "../helpers/network"
import type {
  TAmmConfigBadge,
  TAmmConfigCardContent,
  TAmmConfigCardState,
  TAmmConfigCardViewModel,
  TAmmConfigDetails
} from "../types/TAmmConfigCard"
import useAmmConfigUpdateEligibility from "./useAmmConfigUpdateEligibility"
import useAmmConfigOverview, {
  type AmmConfigStatus
} from "./useAmmConfigOverview"
import useExplorerUrl from "./useExplorerUrl"
import useResolvedAmmConfigId from "./useResolvedAmmConfigId"

const headerTitle = "AMM configuration"
const headerDescription =
  "Snapshot of the on-chain AMM config for this environment."
const missingConfigMessage = "AMM config ID is not configured for this network."
const defaultLoadErrorMessage = "Unable to load AMM config."
const positiveToneClassName =
  "bg-emerald-100/70 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
const negativeToneClassName =
  "bg-rose-100/70 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200"
const badgeBaseClassName =
  "inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]"

const resolveNetworkLabel = (network?: string) =>
  network ? formatNetworkType(network) : "unknown"

const buildBadgeClassName = (toneClassName: string) =>
  `${badgeBaseClassName} ${toneClassName}`

const buildStatusBadge = ({
  isActive,
  activeLabel,
  inactiveLabel
}: {
  isActive: boolean
  activeLabel: string
  inactiveLabel: string
}): TAmmConfigBadge => ({
  label: isActive ? activeLabel : inactiveLabel,
  className: buildBadgeClassName(
    isActive ? positiveToneClassName : negativeToneClassName
  )
})

const buildLaserBadge = (useLaser: boolean): TAmmConfigBadge =>
  buildStatusBadge({
    isActive: useLaser,
    activeLabel: "Enabled",
    inactiveLabel: "Disabled"
  })

const buildTradingBadge = (tradingPaused: boolean): TAmmConfigBadge =>
  buildStatusBadge({
    isActive: !tradingPaused,
    activeLabel: "Live",
    inactiveLabel: "Paused"
  })

const buildAmmConfigDetails = (
  ammConfig: AmmConfigOverview
): TAmmConfigDetails => ({
  baseSpreadBps: ammConfig.baseSpreadBps,
  volatilityMultiplierBps: ammConfig.volatilityMultiplierBps,
  laserBadge: buildLaserBadge(ammConfig.useLaser),
  tradingBadge: buildTradingBadge(ammConfig.tradingPaused),
  pythPriceFeedIdHex: ammConfig.pythPriceFeedIdHex
})

const resolveContentState = ({
  ammConfigId,
  status,
  ammConfig,
  error
}: {
  ammConfigId?: string
  status: AmmConfigStatus
  ammConfig?: AmmConfigOverview
  error?: string
}): TAmmConfigCardContent => {
  if (!ammConfigId) {
    return { state: "missing-id", message: missingConfigMessage }
  }

  if (status === "idle" || status === "loading") {
    return { state: "loading" }
  }

  if (status === "error") {
    return { state: "error", message: error ?? defaultLoadErrorMessage }
  }

  if (!ammConfig) {
    return { state: "error", message: defaultLoadErrorMessage }
  }

  return { state: "ready", details: buildAmmConfigDetails(ammConfig) }
}

const useAmmConfigCardViewModel = (): TAmmConfigCardState => {
  const { network: currentNetwork } = useSuiClientContext()
  const explorerUrl = useExplorerUrl()
  const ammConfigId = useResolvedAmmConfigId()
  const { status, ammConfig, error, refreshAmmConfig, applyAmmConfigUpdate } =
    useAmmConfigOverview(ammConfigId)
  const { canUpdateConfig } = useAmmConfigUpdateEligibility(ammConfigId)

  const networkLabel = useMemo(
    () => resolveNetworkLabel(currentNetwork),
    [currentNetwork]
  )

  const content = useMemo(
    () =>
      resolveContentState({
        ammConfigId,
        status,
        ammConfig,
        error
      }),
    [ammConfigId, status, ammConfig, error]
  )

  const viewModel: TAmmConfigCardViewModel = {
    title: headerTitle,
    description: headerDescription,
    networkLabel,
    explorerUrl,
    ammConfigId,
    content
  }

  return {
    viewModel,
    ammConfig,
    refreshAmmConfig,
    canUpdateConfig,
    applyAmmConfigUpdate
  }
}

export default useAmmConfigCardViewModel
