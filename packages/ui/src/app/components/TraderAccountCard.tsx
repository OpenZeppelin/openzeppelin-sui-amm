"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import useTraderAccountCardViewModel from "../hooks/useTraderAccountCardViewModel"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import CreateTraderAccountModal from "./CreateTraderAccountModal"
import FundTraderAccountModal from "./FundTraderAccountModal"
import TraderAccountCardView from "./TraderAccountCardView"
import WithdrawTraderAccountModal from "./WithdrawTraderAccountModal"

const TraderAccountCard = () => {
  const { viewModel } = useTraderAccountCardViewModel()
  const { overview, refreshTraderAccount, resolution, createAction } =
    useTraderAccountContext()
  const {
    canCreate,
    disabledReason,
    transactionState: createTransactionState,
    resetTransactionState
  } = createAction
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isFundModalOpen, setIsFundModalOpen] = useState(false)
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false)
  const canOpenAccountActionModals = viewModel.content.state === "ready"
  const shouldForceCloseActionModals =
    resolution.status === "wallet-required" ||
    resolution.status === "missing-config" ||
    resolution.status === "not-found" ||
    resolution.status === "error"
  const headerAction = useMemo(() => {
    const shouldShowCreateAction =
      resolution.status === "not-found" ||
      createTransactionState.status === "processing"
    if (!shouldShowCreateAction) return undefined

    return {
      label:
        createTransactionState.status === "processing"
          ? "Creating..."
          : "Create trader account",
      disabled: !canCreate,
      tooltip: disabledReason,
      onClick: () => setIsCreateModalOpen(true)
    }
  }, [
    canCreate,
    createTransactionState.status,
    disabledReason,
    resolution.status
  ])
  const handleCloseCreateModal = useCallback(() => {
    resetTransactionState()
    setIsCreateModalOpen(false)
  }, [resetTransactionState])

  useEffect(() => {
    if (shouldForceCloseActionModals) {
      setIsFundModalOpen(false)
      setIsWithdrawModalOpen(false)
    }
  }, [shouldForceCloseActionModals])

  return (
    <>
      <TraderAccountCardView
        {...viewModel}
        headerAction={headerAction}
        onOpenFundModal={
          canOpenAccountActionModals
            ? () => setIsFundModalOpen(true)
            : undefined
        }
        onOpenWithdrawModal={
          canOpenAccountActionModals
            ? () => setIsWithdrawModalOpen(true)
            : undefined
        }
      />
      <CreateTraderAccountModal
        open={isCreateModalOpen}
        explorerUrl={viewModel.explorerUrl}
        onClose={handleCloseCreateModal}
      />
      <FundTraderAccountModal
        open={isFundModalOpen}
        traderAccountId={overview.traderAccount?.traderAccountId}
        balanceManagerId={overview.traderAccount?.balanceManagerId}
        explorerUrl={viewModel.explorerUrl}
        onClose={() => setIsFundModalOpen(false)}
        onFunded={refreshTraderAccount}
      />
      <WithdrawTraderAccountModal
        open={isWithdrawModalOpen}
        traderAccountId={overview.traderAccount?.traderAccountId}
        balanceManagerId={overview.traderAccount?.balanceManagerId}
        explorerUrl={viewModel.explorerUrl}
        onClose={() => setIsWithdrawModalOpen(false)}
        onWithdrawn={refreshTraderAccount}
      />
    </>
  )
}

export default TraderAccountCard
