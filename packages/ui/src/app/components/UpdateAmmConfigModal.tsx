"use client"

import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import clsx from "clsx"
import { shortenId } from "../helpers/format"
import {
  useUpdateAmmConfigModalState,
  type AmmConfigUpdateSummary
} from "../hooks/useUpdateAmmConfigModalState"
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
  ModalSuccessFooter,
  modalFieldDescriptionClassName,
  modalFieldErrorTextClassName,
  modalFieldInputClassName,
  modalFieldInputErrorClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName
} from "./ModalPrimitives"
import TransactionRecap from "./TransactionRecap"

const inputClassName = (error?: string) =>
  [modalFieldInputClassName, error ? modalFieldInputErrorClassName : ""]
    .filter(Boolean)
    .join(" ")

const toggleButtonClassName = (active: boolean) =>
  clsx(
    "rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] transition",
    active
      ? "border-sds-blue/70 bg-sds-blue/15 dark:border-sds-blue/40 dark:bg-sds-blue/20 text-sds-dark dark:text-sds-light"
      : "border-slate-200/70 text-slate-500 hover:border-slate-300/70 dark:border-slate-50/15 dark:text-slate-200/70 dark:hover:border-slate-50/30"
  )

const ToggleField = ({
  title,
  description,
  value,
  activeLabel,
  inactiveLabel,
  onChange
}: {
  title: string
  description?: string
  value: boolean
  activeLabel: string
  inactiveLabel: string
  onChange: (nextValue: boolean) => void
}) => (
  <label className={modalFieldLabelClassName}>
    <span className={modalFieldTitleClassName}>{title}</span>
    {description ? (
      <span className={modalFieldDescriptionClassName}>{description}</span>
    ) : undefined}
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        className={toggleButtonClassName(value)}
        onClick={() => onChange(true)}
      >
        {activeLabel}
      </button>
      <button
        type="button"
        className={toggleButtonClassName(!value)}
        onClick={() => onChange(false)}
      >
        {inactiveLabel}
      </button>
    </div>
  </label>
)

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
        label="Laser"
        value={summary.ammConfig.useLaser ? "Enabled" : "Disabled"}
      />
      <ConfigValueCard
        label="Trading status"
        value={summary.ammConfig.tradingPaused ? "Paused" : "Live"}
      />
      <div className="sm:col-span-2">
        <ConfigValueCard
          label="Pyth price feed id"
          value={shortenId(summary.ammConfig.pythPriceFeedIdHex, 10, 8)}
          detail={summary.ammConfig.pythPriceFeedIdHex}
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

  if (!open) return <></>

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
          subtitle="Adjust spreads, trading flags, and oracle feed settings."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className={modalFieldLabelClassName}>
              <span className={modalFieldTitleClassName}>
                Base spread (bps)
              </span>
              <span className={modalFieldDescriptionClassName}>
                Must be a positive u64.
              </span>
              <input
                value={formState.baseSpreadBps}
                onChange={(event) =>
                  handleInputChange("baseSpreadBps", event.target.value)
                }
                onBlur={() => markFieldBlur("baseSpreadBps")}
                className={inputClassName(
                  shouldShowFieldError(
                    "baseSpreadBps",
                    fieldErrors.baseSpreadBps
                  )
                    ? fieldErrors.baseSpreadBps
                    : undefined
                )}
                placeholder="25"
              />
              {shouldShowFieldError(
                "baseSpreadBps",
                fieldErrors.baseSpreadBps
              ) ? (
                <span className={modalFieldErrorTextClassName}>
                  {fieldErrors.baseSpreadBps}
                </span>
              ) : undefined}
            </label>

            <label className={modalFieldLabelClassName}>
              <span className={modalFieldTitleClassName}>
                Volatility multiplier (bps)
              </span>
              <span className={modalFieldDescriptionClassName}>
                Zero or higher u64.
              </span>
              <input
                value={formState.volatilityMultiplierBps}
                onChange={(event) =>
                  handleInputChange(
                    "volatilityMultiplierBps",
                    event.target.value
                  )
                }
                onBlur={() => markFieldBlur("volatilityMultiplierBps")}
                className={inputClassName(
                  shouldShowFieldError(
                    "volatilityMultiplierBps",
                    fieldErrors.volatilityMultiplierBps
                  )
                    ? fieldErrors.volatilityMultiplierBps
                    : undefined
                )}
                placeholder="200"
              />
              {shouldShowFieldError(
                "volatilityMultiplierBps",
                fieldErrors.volatilityMultiplierBps
              ) ? (
                <span className={modalFieldErrorTextClassName}>
                  {fieldErrors.volatilityMultiplierBps}
                </span>
              ) : undefined}
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ToggleField
              title="Laser pricing"
              description="Enable or disable the laser pricing path."
              value={formState.useLaser}
              activeLabel="Enabled"
              inactiveLabel="Disabled"
              onChange={(value) => handleInputChange("useLaser", value)}
            />
            <ToggleField
              title="Trading status"
              description="Pause trading without changing spreads."
              value={!formState.tradingPaused}
              activeLabel="Live"
              inactiveLabel="Paused"
              onChange={(value) => handleInputChange("tradingPaused", !value)}
            />
          </div>

          <label className={modalFieldLabelClassName}>
            <span className={modalFieldTitleClassName}>Pyth price feed id</span>
            <span className={modalFieldDescriptionClassName}>
              32-byte hex string (0x...).
            </span>
            <input
              value={formState.pythPriceFeedIdHex}
              onChange={(event) =>
                handleInputChange("pythPriceFeedIdHex", event.target.value)
              }
              onBlur={() => markFieldBlur("pythPriceFeedIdHex")}
              className={inputClassName(
                shouldShowFieldError(
                  "pythPriceFeedIdHex",
                  fieldErrors.pythPriceFeedIdHex
                )
                  ? fieldErrors.pythPriceFeedIdHex
                  : undefined
              )}
              placeholder="0x..."
            />
            {shouldShowFieldError(
              "pythPriceFeedIdHex",
              fieldErrors.pythPriceFeedIdHex
            ) ? (
              <span className={modalFieldErrorTextClassName}>
                {fieldErrors.pythPriceFeedIdHex}
              </span>
            ) : undefined}
          </label>
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
