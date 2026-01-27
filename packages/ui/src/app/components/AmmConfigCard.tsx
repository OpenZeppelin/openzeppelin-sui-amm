"use client"

import { useState } from "react"
import useAmmConfigCardViewModel from "../hooks/useAmmConfigCardViewModel"
import AmmConfigCardView from "./AmmConfigCardView"
import UpdateAmmConfigModal from "./UpdateAmmConfigModal"

const AmmConfigCard = () => {
  const {
    viewModel,
    ammConfig,
    canUpdateConfig,
    applyAmmConfigUpdate
  } = useAmmConfigCardViewModel()
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false)
  const handleOpenUpdateModal = canUpdateConfig
    ? () => setIsUpdateModalOpen(true)
    : undefined

  return (
    <>
      <AmmConfigCardView
        {...viewModel}
        onOpenUpdateModal={handleOpenUpdateModal}
      />
      <UpdateAmmConfigModal
        open={isUpdateModalOpen}
        ammConfigId={viewModel.ammConfigId}
        ammConfig={ammConfig}
        networkLabel={viewModel.networkLabel}
        explorerUrl={viewModel.explorerUrl}
        onClose={() => setIsUpdateModalOpen(false)}
        onConfigUpdated={(updatedConfig) => {
          applyAmmConfigUpdate(updatedConfig)
        }}
      />
    </>
  )
}

export default AmmConfigCard
