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
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
  basePythPriceFeedIdHex: string
  quotePythPriceFeedIdHex: string
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
    key: "baseAssetTypeTag",
    title: "Base asset coin type",
    description:
      "Move type tag of the base asset (e.g. 0x2::sui::SUI). The matching DeepBook pool is resolved from the deployment artifact's `pools` list.",
    placeholder: "0x...::module::TYPE"
  },
  {
    key: "quoteAssetTypeTag",
    title: "Quote asset coin type",
    description:
      "Move type tag of the quote asset (e.g. <coinPackageId>::mock_coin::USDC). Defaults to the localnet USDC mock from the deployment artifact.",
    placeholder: "0x...::module::TYPE"
  },
  {
    key: "basePythPriceFeedIdHex",
    title: "Base Pyth price feed ID",
    description:
      "32-byte hex identifier for the base asset's USD feed. Pre-filled with the SUI/USD feed; override if your base isn't SUI.",
    placeholder: "0x... (64 hex chars)"
  },
  {
    key: "quotePythPriceFeedIdHex",
    title: "Quote Pyth price feed ID",
    description:
      "32-byte hex identifier for the quote asset's USD feed. Pre-filled with the USDC/USD feed; override if your quote isn't USDC.",
    placeholder: "0x... (64 hex chars)"
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
