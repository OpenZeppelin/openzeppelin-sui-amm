export type TTraderAccountAssetBalance = {
  coinType: string
  balance: string
}

export type TTraderAccountAssetBalancesContent =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; balances: TTraderAccountAssetBalance[] }

export type TTraderAccountDetails = {
  ownerAddress: string
  balanceManagerId: string
  tradeCapId?: string
  depositCapId?: string
  withdrawCapId?: string
  activeOrdersTableId?: string
  assetBalances: TTraderAccountAssetBalancesContent
}

export type TTraderAccountCardContent =
  | { state: "loading" }
  | { state: "missing-id"; message: string }
  | { state: "error"; message: string }
  | { state: "ready"; details: TTraderAccountDetails }

export type TTraderAccountCardHeaderAction = {
  label: string
  disabled: boolean
  tooltip?: string
  onClick: () => void
}

export type TTraderAccountCardViewModel = {
  title: string
  description: string
  explorerUrl?: string
  traderAccountId?: string
  content: TTraderAccountCardContent
  headerAction?: TTraderAccountCardHeaderAction
}

export type TTraderAccountCardState = {
  viewModel: TTraderAccountCardViewModel
}
