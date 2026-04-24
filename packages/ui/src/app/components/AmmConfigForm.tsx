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
}

export type AmmConfigFieldErrors = Partial<
  Record<keyof AmmConfigFormState, string>
>

export type AmmConfigFieldKey = keyof AmmConfigFormState

type FieldSpec = {
  key: AmmConfigFieldKey
  title: string
  description: string
  placeholder: string
}

const FIELD_SPECS: FieldSpec[] = [
  {
    key: "baseSpreadBps",
    title: "Base spread (bps)",
    description: "1–9999. Inner order spread from oracle mid.",
    placeholder: "25"
  },
  {
    key: "volatilityMultiplierBps",
    title: "Volatility multiplier (bps)",
    description: "0+. Buffer on top of base spread, scales with Pyth confidence.",
    placeholder: "10000"
  },
  {
    key: "orderExpirationTimeMs",
    title: "Order expiration (ms)",
    description: "> 0. DeepBook order time-to-live.",
    placeholder: "86400000"
  },
  {
    key: "maxPriceAgeSecs",
    title: "Max Pyth price age (s)",
    description: "> 0. Reject oracle updates older than this.",
    placeholder: "60"
  },
  {
    key: "maxConfRatioBps",
    title: "Max conf ratio (bps)",
    description: "1–9999. Reject Pyth prices with wider confidence.",
    placeholder: "1000"
  },
  {
    key: "outerBalanceBps",
    title: "Outer balance (bps)",
    description: "0–9999. Share of balance allocated to outer (volatility) order.",
    placeholder: "5000"
  },
  {
    key: "inventorySkewBps",
    title: "Inventory skew (bps)",
    description: "0–9999. Mid-shift coefficient for inventory imbalance.",
    placeholder: "0"
  }
]

const inputClassName = (errored: boolean) =>
  [modalFieldInputClassName, errored ? modalFieldInputErrorClassName : ""]
    .filter(Boolean)
    .join(" ")

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
}) => (
  <div className="grid gap-4 md:grid-cols-2">
    {FIELD_SPECS.map((spec) => {
      const error = fieldErrors[spec.key]
      const showError = shouldShowFieldError(spec.key, error)
      return (
        <label key={spec.key} className={modalFieldLabelClassName}>
          <span className={modalFieldTitleClassName}>{spec.title}</span>
          <span className={modalFieldDescriptionClassName}>
            {spec.description}
          </span>
          <input
            value={formState[spec.key]}
            onChange={(event) =>
              handleInputChange(spec.key, event.target.value)
            }
            onBlur={() => markFieldBlur(spec.key)}
            disabled={disabled}
            className={inputClassName(showError)}
            placeholder={spec.placeholder}
            inputMode="numeric"
          />
          {showError ? (
            <span className={modalFieldErrorTextClassName}>{error}</span>
          ) : undefined}
        </label>
      )
    })}
  </div>
)

export default AmmConfigForm
