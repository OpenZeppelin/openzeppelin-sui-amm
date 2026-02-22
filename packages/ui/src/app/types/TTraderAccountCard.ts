export type TTraderAccountDetails = {
  ownerAddress: string
  balanceManagerId: string
  tradeCapId?: string
  depositCapId?: string
  withdrawCapId?: string
  activeOrdersTableId?: string
}

export type TTraderAccountCardContent =
  | { state: "loading" }
  | { state: "missing-id"; message: string }
  | { state: "error"; message: string }
  | { state: "ready"; details: TTraderAccountDetails }

export type TTraderAccountCardViewModel = {
  title: string
  description: string
  explorerUrl?: string
  traderAccountId?: string
  content: TTraderAccountCardContent
}

export type TTraderAccountCardState = {
  viewModel: TTraderAccountCardViewModel
}
