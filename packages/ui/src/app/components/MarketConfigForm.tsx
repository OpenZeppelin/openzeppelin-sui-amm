"use client"

import {
  modalFieldDescriptionClassName,
  modalFieldErrorTextClassName,
  modalFieldInputClassName,
  modalFieldInputErrorClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName
} from "./ModalPrimitives"

export type MarketConfigFormState = {
  poolId: string
}

export type MarketConfigFieldErrors = Partial<
  Record<keyof MarketConfigFormState, string>
>

export type MarketConfigFieldKey = keyof MarketConfigFormState

type FieldSpec = {
  key: MarketConfigFieldKey
  title: string
  description: string
  placeholder: string
}

const FIELD_SPECS: FieldSpec[] = [
  {
    key: "poolId",
    title: "DeepBook pool object ID",
    description:
      "Shared Pool<Base, Quote> object. Base/quote asset types, Currency<T> objects, and Pyth price feed IDs are auto-resolved from the pool's coin types.",
    placeholder: "0x..."
  }
]

const inputClassName = (errored: boolean) =>
  [modalFieldInputClassName, errored ? modalFieldInputErrorClassName : ""]
    .filter(Boolean)
    .join(" ")

export const MarketConfigForm = ({
  formState,
  fieldErrors,
  shouldShowFieldError,
  handleInputChange,
  markFieldBlur,
  disabled
}: {
  formState: MarketConfigFormState
  fieldErrors: MarketConfigFieldErrors
  shouldShowFieldError: <K extends MarketConfigFieldKey>(
    key: K,
    error?: string
  ) => error is string
  handleInputChange: <K extends MarketConfigFieldKey>(
    key: K,
    value: MarketConfigFormState[K]
  ) => void
  markFieldBlur: (key: MarketConfigFieldKey) => void
  disabled?: boolean
}) => (
  <div className="flex flex-col gap-4">
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
            spellCheck={false}
          />
          {showError ? (
            <span className={modalFieldErrorTextClassName}>{error}</span>
          ) : undefined}
        </label>
      )
    })}
  </div>
)

export default MarketConfigForm
