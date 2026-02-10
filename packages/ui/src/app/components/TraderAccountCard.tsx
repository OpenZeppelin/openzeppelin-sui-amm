"use client"

import useTraderAccountCardViewModel from "../hooks/useTraderAccountCardViewModel"
import TraderAccountCardView from "./TraderAccountCardView"

const TraderAccountCard = () => {
  const { viewModel } = useTraderAccountCardViewModel()

  return <TraderAccountCardView {...viewModel} />
}

export default TraderAccountCard
