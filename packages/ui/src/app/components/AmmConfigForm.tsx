"use client"

import {
  modalFieldDescriptionClassName,
  modalFieldErrorTextClassName,
  modalFieldInputClassName,
  modalFieldInputErrorClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName
} from "./ModalPrimitives"

export type AmmConfigFormState = {
  baseSpreadBps: string
  volatilityMultiplierBps: string
  orderExpirationTimeMs: string
  maxPriceAgeSecs: string
  maxConfRatioBps: string
  outerBalanceBps: string
  inventorySkewBps: string
  postOnly: string
}

export type AmmConfigFieldErrors = Partial<
  Record<keyof AmmConfigFormState, string>
>

export type AmmConfigFieldKey = keyof AmmConfigFormState

type BpsFieldSpec = {
  kind: "bps"
  key: AmmConfigFieldKey
  title: string
  description: string
  /** Inclusive upper bound on the slider, in bps. The text input lets
   * users type larger values for fields without a Move-side cap. */
  sliderMaxBps: number
}

type NumericFieldSpec = {
  kind: "numeric"
  key: AmmConfigFieldKey
  title: string
  description: string
  placeholder: string
}

type ToggleFieldSpec = {
  kind: "toggle"
  key: AmmConfigFieldKey
  title: string
  description: string
  /** Label shown next to the checkbox. */
  toggleLabel: string
}

type FieldSpec = BpsFieldSpec | NumericFieldSpec | ToggleFieldSpec

type GroupSpec = {
  title: string
  description: string
  fields: FieldSpec[]
  /** Field layout inside the group. `stack` (default) places each field on
   * its own row — required for bps fields whose sliders need full width.
   * `two-column` puts two fields side-by-side at `sm` and up — suits short
   * numeric inputs like the Order Lifecycle pair. */
  layout?: "stack" | "two-column"
}

// Slider ceiling for capped bps fields (Move enforces `< 10_000`). Stops one
// step below 100 % so the user can't accidentally hit the edge with the
// slider — typing the exact value is still allowed.
const SLIDER_MAX_BOUNDED_BPS = 9999
// `volatility_multiplier_bps` has no Move-side ceiling. 200 % covers the
// realistic operating range; users can still type higher manually.
const SLIDER_MAX_VOLATILITY_BPS = 20_000

const GROUPS: GroupSpec[] = [
  {
    title: "Spread / Volatility",
    description:
      "How far the AMM's quotes sit from the oracle mid, plus the buffer that scales with Pyth confidence.",
    fields: [
      {
        kind: "bps",
        key: "baseSpreadBps",
        title: "Base spread",
        description:
          "Inner order spread from oracle mid. Below 100 % of the mid.",
        sliderMaxBps: SLIDER_MAX_BOUNDED_BPS
      },
      {
        kind: "bps",
        key: "volatilityMultiplierBps",
        title: "Volatility multiplier",
        description:
          "Buffer on top of the base spread, scaled by Pyth confidence.",
        sliderMaxBps: SLIDER_MAX_VOLATILITY_BPS
      },
      {
        kind: "bps",
        key: "maxConfRatioBps",
        title: "Max confidence ratio",
        description:
          "Reject Pyth prices with confidence wider than this fraction of the price.",
        sliderMaxBps: SLIDER_MAX_BOUNDED_BPS
      }
    ]
  },
  {
    title: "Inventory",
    description:
      "How the executor splits its book across inner / outer orders and skews the mid based on imbalance.",
    fields: [
      {
        kind: "bps",
        key: "outerBalanceBps",
        title: "Outer balance",
        description:
          "Share of the BalanceManager balance allocated to the outer (volatility) order.",
        sliderMaxBps: SLIDER_MAX_BOUNDED_BPS
      },
      {
        kind: "bps",
        key: "inventorySkewBps",
        title: "Inventory skew",
        description:
          "Mid-shift coefficient applied when base/quote inventory is imbalanced.",
        sliderMaxBps: SLIDER_MAX_BOUNDED_BPS
      }
    ]
  },
  {
    title: "Order Lifecycle",
    description:
      "How long DeepBook orders stay alive and how stale a Pyth read is allowed to be.",
    layout: "two-column",
    fields: [
      {
        kind: "numeric",
        key: "orderExpirationTimeMs",
        title: "Order expiration (ms)",
        description: "DeepBook order time-to-live in milliseconds.",
        placeholder: "86400000"
      },
      {
        kind: "numeric",
        key: "maxPriceAgeSecs",
        title: "Max Pyth price age (s)",
        description: "Reject oracle reads older than this many seconds.",
        placeholder: "60"
      }
    ]
  },
  {
    title: "Safety",
    description:
      "How refresh_quotes places its orders relative to the resting book.",
    fields: [
      {
        kind: "toggle",
        key: "postOnly",
        title: "Post-only quotes",
        description:
          "When enabled, an order that would cross the book aborts the whole refresh and the previous quotes stay live until the next oracle reading. When disabled, the crossing portion executes as a taker.",
        toggleLabel: "Abort refresh on cross (post-only)"
      }
    ]
  }
]

const inputClassName = (errored: boolean) =>
  [modalFieldInputClassName, errored ? modalFieldInputErrorClassName : ""]
    .filter(Boolean)
    .join(" ")

const PERCENT_FRACTION_DIGITS = 2

const formatPercentFromBps = (bpsRaw: string): string => {
  const trimmed = bpsRaw.trim()
  if (!trimmed) return ""
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) return trimmed
  return (numeric / 100).toFixed(PERCENT_FRACTION_DIGITS)
}

const bpsFromPercentInput = (raw: string): string | undefined => {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  // Accept both `,` and `.` decimal separators because we render with `.`.
  const normalized = trimmed.replace(",", ".")
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) return undefined
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric) || numeric < 0) return undefined
  return String(Math.round(numeric * 100))
}

const BpsField = ({
  spec,
  value,
  errorMessage,
  showError,
  disabled,
  onChange,
  onBlur
}: {
  spec: BpsFieldSpec
  value: string
  errorMessage?: string
  showError: boolean
  disabled?: boolean
  onChange: (next: string) => void
  onBlur: () => void
}) => {
  const percentDisplay = formatPercentFromBps(value)
  const sliderValue = (() => {
    const numeric = Number(value || "0")
    if (!Number.isFinite(numeric)) return 0
    if (numeric < 0) return 0
    if (numeric > spec.sliderMaxBps) return spec.sliderMaxBps
    return numeric
  })()

  return (
    <label key={spec.key} className={modalFieldLabelClassName}>
      <span className={modalFieldTitleClassName}>{spec.title}</span>
      <span className={modalFieldDescriptionClassName}>{spec.description}</span>
      <div className="mt-1 flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-1">
          <input
            value={percentDisplay}
            onChange={(event) => {
              const next = bpsFromPercentInput(event.target.value)
              if (next !== undefined) onChange(next)
            }}
            onBlur={onBlur}
            disabled={disabled}
            className={`${inputClassName(showError)} w-24 text-right tabular-nums`}
            inputMode="decimal"
            placeholder="0.00"
          />
          <span className="text-xs font-medium text-slate-500 dark:text-slate-200/70">
            %
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={spec.sliderMaxBps}
          step={1}
          value={sliderValue}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className="flex-1 accent-sds-blue"
          aria-label={`${spec.title} slider`}
        />
      </div>
      {showError && errorMessage ? (
        <span className={modalFieldErrorTextClassName}>{errorMessage}</span>
      ) : undefined}
    </label>
  )
}

const NumericField = ({
  spec,
  value,
  errorMessage,
  showError,
  disabled,
  onChange,
  onBlur
}: {
  spec: NumericFieldSpec
  value: string
  errorMessage?: string
  showError: boolean
  disabled?: boolean
  onChange: (next: string) => void
  onBlur: () => void
}) => (
  <label key={spec.key} className={modalFieldLabelClassName}>
    <span className={modalFieldTitleClassName}>{spec.title}</span>
    <span className={modalFieldDescriptionClassName}>{spec.description}</span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      className={inputClassName(showError)}
      placeholder={spec.placeholder}
      inputMode="numeric"
    />
    {showError && errorMessage ? (
      <span className={modalFieldErrorTextClassName}>{errorMessage}</span>
    ) : undefined}
  </label>
)

const ToggleField = ({
  spec,
  value,
  disabled,
  onChange,
  onBlur
}: {
  spec: ToggleFieldSpec
  value: string
  disabled?: boolean
  onChange: (next: string) => void
  onBlur: () => void
}) => {
  const checked = value.trim().toLowerCase() === "true"
  return (
    <label key={spec.key} className={modalFieldLabelClassName}>
      <span className={modalFieldTitleClassName}>{spec.title}</span>
      <span className={modalFieldDescriptionClassName}>{spec.description}</span>
      <span className="mt-1 inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) =>
            onChange(event.target.checked ? "true" : "false")
          }
          onBlur={onBlur}
          disabled={disabled}
          className="h-4 w-4 accent-sds-blue"
        />
        {spec.toggleLabel}
      </span>
    </label>
  )
}

export const AmmConfigForm = ({
  formState,
  fieldErrors,
  shouldShowFieldError,
  handleInputChange,
  markFieldBlur,
  disabled
}: {
  formState: AmmConfigFormState
  fieldErrors: AmmConfigFieldErrors
  shouldShowFieldError: <K extends AmmConfigFieldKey>(
    key: K,
    error?: string
  ) => error is string
  handleInputChange: <K extends AmmConfigFieldKey>(
    key: K,
    value: AmmConfigFormState[K]
  ) => void
  markFieldBlur: (key: AmmConfigFieldKey) => void
  disabled?: boolean
}) => {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6">
        {GROUPS.map((group) => (
          <fieldset
            key={group.title}
            className="flex flex-col gap-4 rounded-xl border border-slate-200/70 bg-slate-50/40 px-4 py-4 dark:border-slate-50/15 dark:bg-slate-950/30"
          >
            <legend className="px-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/70">
              {group.title}
            </legend>
            <p className="text-xs text-slate-500 dark:text-slate-200/70">
              {group.description}
            </p>
            <div
              className={
                group.layout === "two-column"
                  ? "grid grid-cols-1 gap-4 sm:grid-cols-2"
                  : "flex flex-col gap-4"
              }
            >
              {group.fields.map((spec) => {
                const error = fieldErrors[spec.key]
                const showError = shouldShowFieldError(spec.key, error)
                if (spec.kind === "bps") {
                  return (
                    <BpsField
                      key={spec.key}
                      spec={spec}
                      value={formState[spec.key]}
                      errorMessage={error}
                      showError={showError}
                      disabled={disabled}
                      onChange={(next) => handleInputChange(spec.key, next)}
                      onBlur={() => markFieldBlur(spec.key)}
                    />
                  )
                }
                if (spec.kind === "toggle") {
                  return (
                    <ToggleField
                      key={spec.key}
                      spec={spec}
                      value={formState[spec.key]}
                      disabled={disabled}
                      onChange={(next) => handleInputChange(spec.key, next)}
                      onBlur={() => markFieldBlur(spec.key)}
                    />
                  )
                }
                return (
                  <NumericField
                    key={spec.key}
                    spec={spec}
                    value={formState[spec.key]}
                    errorMessage={error}
                    showError={showError}
                    disabled={disabled}
                    onChange={(next) => handleInputChange(spec.key, next)}
                    onBlur={() => markFieldBlur(spec.key)}
                  />
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  )
}

export default AmmConfigForm
