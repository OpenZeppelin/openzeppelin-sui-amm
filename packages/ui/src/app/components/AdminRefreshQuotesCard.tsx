"use client"

import { getStructLabel } from "@sui-amm/tooling-core/utils/formatters"

import { useAdminRefreshQuotesState } from "../hooks/useAdminRefreshQuotesState"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import Button from "./Button"
import {
  modalFieldDescriptionClassName,
  modalFieldErrorTextClassName,
  modalFieldInputClassName,
  modalFieldInputErrorClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName
} from "./ModalPrimitives"

const inputClassName = (errored: boolean) =>
  [modalFieldInputClassName, errored ? modalFieldInputErrorClassName : ""]
    .filter(Boolean)
    .join(" ")

const AdminRefreshQuotesCard = () => {
  const {
    formState,
    fieldErrors,
    transactionState,
    canSubmit,
    disabledReason,
    isProcessing,
    handleInputChange,
    handleSubmit
  } = useAdminRefreshQuotesState()

  const { overview } = useTraderAccountContext()
  const traderAccount =
    overview.status === "success" ? overview.traderAccount : undefined
  const baseSymbol = traderAccount
    ? getStructLabel(traderAccount.baseCoinType)
    : ""
  const quoteSymbol = traderAccount
    ? getStructLabel(traderAccount.quoteCoinType)
    : ""
  const priceUnitLabel =
    baseSymbol && quoteSymbol ? `${quoteSymbol} per ${baseSymbol}` : "quote / base"

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
            Refresh Quotes (admin)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-200/70">
            Bypasses Pyth and re-quotes the ladder with a caller-supplied mid
            price and confidence ratio. Requires your AdminCap and an active
            executor. Calls{" "}
            <code className="font-mono">executor::refresh_quotes</code>.
          </p>
          {disabledReason ? (
            <div className="text-[0.7rem] text-amber-700 dark:text-amber-200">
              {disabledReason}
            </div>
          ) : undefined}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isProcessing ? "Refreshing…" : "Refresh quotes"}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className={modalFieldLabelClassName}>
            <span className={modalFieldTitleClassName}>Mid price</span>
            <span className={modalFieldDescriptionClassName}>
              In {priceUnitLabel}. Converted to DeepBook fixed-point on submit.
            </span>
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder="1.50"
            value={formState.priceDollars}
            onChange={(event) =>
              handleInputChange("priceDollars", event.target.value)
            }
            disabled={isProcessing}
            className={inputClassName(Boolean(fieldErrors.priceDollars))}
          />
          {fieldErrors.priceDollars ? (
            <div className={modalFieldErrorTextClassName}>
              {fieldErrors.priceDollars}
            </div>
          ) : undefined}
        </div>

        <div>
          <div className={modalFieldLabelClassName}>
            <span className={modalFieldTitleClassName}>
              Confidence ratio (%)
            </span>
            <span className={modalFieldDescriptionClassName}>
              Drives the outer-spread volatility add-on:{" "}
              <code className="font-mono">conf_ratio_bps = percent × 100</code>.
            </span>
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={formState.confRatioPercent}
            onChange={(event) =>
              handleInputChange("confRatioPercent", event.target.value)
            }
            disabled={isProcessing}
            className={inputClassName(Boolean(fieldErrors.confRatioPercent))}
          />
          {fieldErrors.confRatioPercent ? (
            <div className={modalFieldErrorTextClassName}>
              {fieldErrors.confRatioPercent}
            </div>
          ) : undefined}
        </div>
      </div>

      {transactionState.status === "error" ? (
        <div className="mt-4 rounded-xl border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-[0.7rem] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <div className="font-semibold">refresh_quotes failed</div>
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
    </section>
  )
}

export default AdminRefreshQuotesCard
