"use client"

import AmmConfigForm from "../../components/AmmConfigForm"
import Button from "../../components/Button"
import Loading from "../../components/Loading"
import NetworkSupportChecker from "../../components/NetworkSupportChecker"
import useAmmConfigOverview from "../../hooks/useAmmConfigOverview"
import { useUpdateAmmConfigModalState } from "../../hooks/useUpdateAmmConfigModalState"
import { useTraderAccountContext } from "../../providers/TraderAccountProvider"

const SectionCard = ({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) => (
  <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
    <div className="mb-4 flex flex-col gap-1">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-xs text-slate-500 dark:text-slate-200/70">
          {subtitle}
        </p>
      ) : undefined}
    </div>
    {children}
  </section>
)

export default function ConfigPage() {
  const { resolution } = useTraderAccountContext()
  const ammConfigId = resolution.traderAccountId
  const {
    ammConfig,
    status: loadStatus,
    error: loadError,
    applyAmmConfigUpdate
  } = useAmmConfigOverview(ammConfigId)

  const {
    formState,
    fieldErrors,
    transactionState,
    canSubmit,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    handleUpdateAmmConfig
  } = useUpdateAmmConfigModalState({
    open: true,
    ammConfigId,
    ammConfig,
    onConfigUpdated: applyAmmConfigUpdate
  })

  const isProcessing = transactionState.status === "processing"
  const submitLabel = isProcessing ? "Updating..." : "Update config"

  const renderBody = () => {
    if (loadStatus === "idle" || loadStatus === "loading") {
      return <Loading />
    }
    if (loadStatus === "error") {
      return (
        <div className="rounded-xl border border-rose-200/80 bg-rose-50/70 px-4 py-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {loadError ?? "Unable to load the current AMM configuration."}
        </div>
      )
    }
    if (!ammConfig) return null

    return (
      <>
        <AmmConfigForm
          formState={formState}
          fieldErrors={fieldErrors}
          shouldShowFieldError={shouldShowFieldError}
          handleInputChange={handleInputChange}
          markFieldBlur={markFieldBlur}
          disabled={isProcessing}
        />

        {transactionState.status === "error" ? (
          <div className="mt-4 rounded-xl border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-[0.7rem] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <div className="font-semibold">Update failed</div>
            <div className="mt-1">{transactionState.error}</div>
            {transactionState.details ? (
              <details className="mt-2">
                <summary className="cursor-pointer font-semibold">
                  Raw error JSON
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded border border-rose-200/60 bg-white/80 p-2 text-[0.6rem] dark:border-rose-500/30 dark:bg-slate-950/60">
                  {transactionState.details}
                </pre>
              </details>
            ) : undefined}
          </div>
        ) : undefined}

        <div className="mt-4 flex items-center justify-end">
          <Button onClick={handleUpdateAmmConfig} disabled={!canSubmit}>
            {submitLabel}
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <NetworkSupportChecker />
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-sds-dark dark:text-sds-light">
          Configuration
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-200/70">
          Live values for your AMM configuration. Edit any field and submit to
          replace the on-chain config (gated by your AdminCap).
        </p>
      </header>

      <SectionCard
        title="AMM configuration"
        subtitle="Spread, volatility, and inventory-aware pricing parameters."
      >
        {renderBody()}
      </SectionCard>
    </>
  )
}
