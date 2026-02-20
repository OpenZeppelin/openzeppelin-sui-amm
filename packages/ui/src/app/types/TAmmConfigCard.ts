import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"

export type TAmmConfigBadge = {
  label: string
  className: string
}

export type TAmmConfigDetails = {
  baseSpreadBps: string
  volatilityMultiplierBps: string
  laserBadge: TAmmConfigBadge
  tradingBadge: TAmmConfigBadge
  pythPriceFeedIdHex?: string
}

export type TAmmConfigCardContent =
  | { state: "missing-id"; message: string }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; details: TAmmConfigDetails }

export type TAmmConfigCardViewModel = {
  title: string
  description: string
  networkLabel: string
  explorerUrl?: string
  ammConfigId?: string
  content: TAmmConfigCardContent
}

export type TAmmConfigCardState = {
  viewModel: TAmmConfigCardViewModel
  ammConfig?: AmmConfigOverview
  refreshAmmConfig: () => void
  canUpdateConfig: boolean
  applyAmmConfigUpdate: (ammConfig: AmmConfigOverview) => void
}
