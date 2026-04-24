"use client"

import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import { shortenId } from "../helpers/format"
import {
  useUpdateAmmConfigModalState,
  type AmmConfigUpdateSummary
} from "../hooks/useUpdateAmmConfigModalState"
import AmmConfigForm from "./AmmConfigForm"
import Button from "./Button"
import CopyableId from "./CopyableId"
import {
  ModalBody,
  ModalErrorFooter,
  ModalErrorNotice,
  ModalFrame,
  ModalHeader,
  ModalSection,
  ModalStatusHeader,
  ModalSuccessFooter
} from "./ModalPrimitives"
import TransactionRecap from "./TransactionRecap"

const ConfigValueCard = ({
  label,
  value,
  detail
}: {
  label: string
  value: string
  detail?: string
}) => (
  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 text-xs dark:border-slate-50/15 dark:bg-slate-950/60">
    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
      {label}
    </div>
    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
      {value}
    </div>
    {detail ? (
      <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
        {detail}
      </div>
    ) : undefined}
  </div>
)

const AmmConfigSummarySection = ({
  summary,
  explorerUrl
}: {
  summary: AmmConfigUpdateSummary
  explorerUrl?: string
}) => (
  <ModalSection
    title="Updated configuration"
    subtitle="Latest on-chain values for this AMM"
  >
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <ConfigValueCard
        label="Base spread (bps)"
        value={summary.ammConfig.baseSpreadBps}
      />
      <ConfigValueCard
        label="Volatility multiplier (bps)"
        value={summary.ammConfig.volatilityMultiplierBps}
      />
      <ConfigValueCard
        label="Order expiration (ms)"
        value={summary.ammConfig.orderExpirationTimeMs}
      />
      <ConfigValueCard
        label="Max Pyth price age (s)"
        value={summary.ammConfig.maxPriceAgeSecs}
      />
      <ConfigValueCard
        label="Max conf ratio (bps)"
        value={summary.ammConfig.maxConfRatioBps}
      />
      <ConfigValueCard
        label="Outer balance (bps)"
        value={summary.ammConfig.outerBalanceBps}
      />
      <ConfigValueCard
        label="Inventory skew (bps)"
        value={summary.ammConfig.inventorySkewBps}
      />
      <ConfigValueCard
        label="Trading status"
        value={summary.ammConfig.active ? "Live" : "Paused"}
      />
      <div className="sm:col-span-2">
        <ConfigValueCard
          label="Base Pyth price feed id"
          value={shortenId(summary.ammConfig.basePythPriceFeedIdHex, 10, 8)}
          detail={summary.ammConfig.basePythPriceFeedIdHex}
        />
      </div>
      <div className="sm:col-span-2">
        <ConfigValueCard
          label="Quote Pyth price feed id"
          value={shortenId(summary.ammConfig.quotePythPriceFeedIdHex, 10, 8)}
          detail={summary.ammConfig.quotePythPriceFeedIdHex}
        />
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      <CopyableId
        value={summary.ammConfig.configId}
        label="AMM config"
        explorerUrl={explorerUrl}
      />
      <CopyableId
        value={summary.adminCapId}
        label="Admin cap"
        explorerUrl={explorerUrl}
      />
    </div>
  </ModalSection>
)

const AmmConfigSuccessView = ({
  summary,
  explorerUrl,
  onClose,
  onReset
}: {
  summary: AmmConfigUpdateSummary
  explorerUrl?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="AMM config updated"
      subtitle={shortenId(summary.ammConfig.configId)}
      description="The updated settings are now live on-chain."
      onClose={onClose}
    />
    <ModalBody>
      <AmmConfigSummarySection summary={summary} explorerUrl={explorerUrl} />
      <TransactionRecap
        transactionBlock={summary.transactionBlock}
        digest={summary.digest}
        explorerUrl={explorerUrl}
      />
    </ModalBody>
    <ModalSuccessFooter
      actionLabel="Update again"
      onAction={onReset}
      onClose={onClose}
    />
  </>
)

const AmmConfigErrorView = ({
  error,
  details,
  onClose,
  onReset
}: {
  error: string
  details?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="AMM update failed"
      subtitle="Check the details and try again."
      description="Resolve the issue before resubmitting the update."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const UpdateAmmConfigModal = ({
  open,
  ammConfigId,
  ammConfig,
  networkLabel,
  explorerUrl,
  onClose,
  onConfigUpdated
}: {
  open: boolean
  ammConfigId?: string
  ammConfig?: AmmConfigOverview
  networkLabel: string
  explorerUrl?: string
  onClose: () => void
  onConfigUpdated?: (config: AmmConfigOverview) => void
}) => {
  const {
    formState,
    fieldErrors,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    handleUpdateAmmConfig,
    resetForm
  } = useUpdateAmmConfigModalState({
    open,
    ammConfigId,
    ammConfig,
    onConfigUpdated
  })

  if (!open) return null

  if (isSuccessState && transactionSummary) {
    return (
      <ModalFrame onClose={onClose}>
        <AmmConfigSuccessView
          summary={transactionSummary}
          explorerUrl={explorerUrl}
          onClose={onClose}
          onReset={resetForm}
        />
      </ModalFrame>
    )
  }

  if (isErrorState && transactionState.status === "error") {
    return (
      <ModalFrame onClose={onClose}>
        <AmmConfigErrorView
          error={transactionState.error}
          details={transactionState.details}
          onClose={onClose}
          onReset={resetForm}
        />
      </ModalFrame>
    )
  }

  return (
    <ModalFrame onClose={onClose}>
      <ModalHeader
        eyebrow="AMM configuration"
        title="Update AMM config"
        description={`Network: ${networkLabel}`}
        onClose={onClose}
      />
      <ModalBody>
        {ammConfigId ? (
          <ModalSection
            title="Target configuration"
            subtitle="Updates apply to the shared AMM config object."
          >
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              <CopyableId
                value={ammConfigId}
                label="AMM config"
                explorerUrl={explorerUrl}
              />
            </div>
          </ModalSection>
        ) : (
          <div className="rounded-2xl border border-rose-200/70 bg-rose-50/70 px-4 py-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            AMM config ID is not configured for this network.
          </div>
        )}

        <ModalSection
          title="Configuration updates"
          subtitle="Adjust AMM parameters. Pool and Pyth feed updates are handled in a separate flow."
        >
          <AmmConfigForm
            formState={formState}
            fieldErrors={fieldErrors}
            shouldShowFieldError={shouldShowFieldError}
            handleInputChange={handleInputChange}
            markFieldBlur={markFieldBlur}
            disabled={transactionState.status === "processing"}
          />

          {ammConfig ? (
            <div className="mt-4 grid gap-3 text-xs sm:grid-cols-1">
              <ConfigValueCard
                label="Base Pyth price feed id (read-only)"
                value={shortenId(ammConfig.basePythPriceFeedIdHex, 10, 8)}
                detail={ammConfig.basePythPriceFeedIdHex}
              />
              <ConfigValueCard
                label="Quote Pyth price feed id (read-only)"
                value={shortenId(ammConfig.quotePythPriceFeedIdHex, 10, 8)}
                detail={ammConfig.quotePythPriceFeedIdHex}
              />
            </div>
          ) : undefined}
        </ModalSection>
      </ModalBody>

      <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            {transactionState.status === "processing"
              ? "Waiting for wallet confirmation..."
              : "Ready to update the AMM configuration."}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleUpdateAmmConfig} disabled={!canSubmit}>
              {transactionState.status === "processing"
                ? "Processing..."
                : "Update config"}
            </Button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

export default UpdateAmmConfigModal
