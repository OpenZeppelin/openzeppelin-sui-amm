"use client"

import useAmmConfigCardViewModel from "../hooks/useAmmConfigCardViewModel"
import AmmConfigCardView from "./AmmConfigCardView"

const AmmConfigCard = () => {
  const viewModel = useAmmConfigCardViewModel()
  return <AmmConfigCardView {...viewModel} />
}

export default AmmConfigCard
