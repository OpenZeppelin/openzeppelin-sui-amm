"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import AmmConfigForm from "../components/AmmConfigForm"
import Button from "../components/Button"
import MarketConfigForm from "../components/MarketConfigForm"
import NetworkSupportChecker from "../components/NetworkSupportChecker"
import { useCreateExecutorState } from "../hooks/useCreateExecutorState"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"

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

export default function SetupPage() {
  const router = useRouter()
  const { resolution } = useTraderAccountContext()
  const {
    ammFormState,
    ammFieldErrors,
    ammHandleInputChange,
    ammMarkFieldBlur,
    ammShouldShowFieldError,
    marketFormState,
    marketFieldErrors,
    marketHandleInputChange,
    marketMarkFieldBlur,
    marketShouldShowFieldError,
    transactionState,
    canSubmit,
    handleCreateExecutor
  } = useCreateExecutorState()

  useEffect(() => {
    if (resolution.status === "ready") {
      router.replace("/dashboard")
    }
  }, [resolution.status, router])

  if (resolution.status === "ready") {
    return null
  }

  const isProcessing = transactionState.status === "processing"
  const submitLabel = isProcessing ? "Submitting..." : "Create market maker"

  return (
    <>
      <NetworkSupportChecker />
      <div className="flex w-full flex-grow flex-col items-center px-3 py-6">
        <div className="flex w-full max-w-4xl flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold text-sds-dark dark:text-sds-light">
              Create your market maker
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-200/70">
              Configure a DeepBook market and AMM parameters, then submit to
              publish a new executor on-chain. Base and quote asset types are
              derived from the pool; currency objects are resolved via the coin
              registry.
            </p>
          </header>

          <SectionCard
            title="Market configuration"
            subtitle="DeepBook pool + Pyth price feeds for base and quote."
          >
            <MarketConfigForm
              formState={marketFormState}
              fieldErrors={marketFieldErrors}
              shouldShowFieldError={marketShouldShowFieldError}
              handleInputChange={marketHandleInputChange}
              markFieldBlur={marketMarkFieldBlur}
              disabled={isProcessing}
            />
          </SectionCard>

          <SectionCard
            title="AMM configuration"
            subtitle="Spread, volatility, and inventory-aware pricing parameters."
          >
            <AmmConfigForm
              formState={ammFormState}
              fieldErrors={ammFieldErrors}
              shouldShowFieldError={ammShouldShowFieldError}
              handleInputChange={ammHandleInputChange}
              markFieldBlur={ammMarkFieldBlur}
              disabled={isProcessing}
            />
          </SectionCard>

          {transactionState.status === "error" ? (
            <div className="rounded-2xl border border-rose-200/80 bg-rose-50/70 px-4 py-4 text-xs dark:border-rose-500/30 dark:bg-rose-500/10">
              <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-rose-700/95 dark:text-rose-200/90">
                Error
              </div>
              <div className="mt-2 text-sm font-semibold text-rose-800 dark:text-rose-100">
                Create failed
              </div>
              <div className="mt-2 text-[0.7rem] text-rose-700/90 dark:text-rose-200/90">
                {transactionState.error}
              </div>
              {transactionState.details ? (
                <details className="mt-3 text-[0.7rem] text-rose-700/90 dark:text-rose-200/90">
                  <summary className="cursor-pointer font-semibold">
                    Raw error JSON
                  </summary>
                  <pre className="mb-4 mt-2 max-h-40 overflow-auto rounded-lg border border-rose-200/60 bg-white/80 p-2 text-[0.65rem] text-rose-700 dark:border-rose-500/30 dark:bg-slate-950/60 dark:text-rose-200">
                    {transactionState.details}
                  </pre>
                </details>
              ) : undefined}
            </div>
          ) : undefined}

          {transactionState.status === "success" ? (
            <div className="rounded-2xl border border-emerald-300/70 bg-emerald-50/70 px-4 py-4 text-xs dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-emerald-800 dark:text-emerald-200">
                Success
              </div>
              <div className="mt-2 text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                Market maker created
              </div>
              <div className="mt-2 text-[0.7rem] text-emerald-800/90 dark:text-emerald-200/90">
                Redirecting to dashboard...
              </div>
            </div>
          ) : undefined}

          {!canSubmit && transactionState.status !== "processing" ? (
            <div className="rounded-xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs text-slate-600 dark:border-slate-50/15 dark:bg-slate-950/40 dark:text-slate-200/80">
              <div className="mb-1 font-semibold uppercase tracking-[0.18em]">
                Fix before submitting
              </div>
              <ul className="ml-4 list-disc space-y-0.5">
                {[
                  ...Object.values(marketFieldErrors).filter(Boolean),
                  ...Object.values(ammFieldErrors).filter(Boolean)
                ].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : undefined}

          <div className="flex items-center justify-end">
            <Button onClick={handleCreateExecutor} disabled={!canSubmit}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
