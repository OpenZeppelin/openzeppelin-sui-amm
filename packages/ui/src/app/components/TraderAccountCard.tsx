"use client"

import { useEffect, useState } from "react"
import useTraderAccountCardViewModel from "../hooks/useTraderAccountCardViewModel"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import FundTraderAccountModal from "./FundTraderAccountModal"
import TraderAccountCardView from "./TraderAccountCardView"

const TraderAccountCard = () => {
  const { viewModel } = useTraderAccountCardViewModel()
  const { overview, refreshTraderAccount } = useTraderAccountContext()
  const [isFundModalOpen, setIsFundModalOpen] = useState(false)
  const canOpenFundModal = viewModel.content.state === "ready"

  useEffect(() => {
    if (!canOpenFundModal) {
      setIsFundModalOpen(false)
    }
  }, [canOpenFundModal])

  return (
    <>
      <TraderAccountCardView
        {...viewModel}
        onOpenFundModal={
          canOpenFundModal ? () => setIsFundModalOpen(true) : undefined
        }
      />
      <FundTraderAccountModal
        open={isFundModalOpen}
        traderAccountId={overview.traderAccount?.traderAccountId}
        balanceManagerId={overview.traderAccount?.balanceManagerId}
        explorerUrl={viewModel.explorerUrl}
        onClose={() => setIsFundModalOpen(false)}
        onFunded={refreshTraderAccount}
      />
    </>
  )
}

export default TraderAccountCard
