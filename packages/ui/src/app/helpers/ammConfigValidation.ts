import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import {
  DEFAULT_BASE_SPREAD_BPS,
  DEFAULT_INVENTORY_SKEW_BPS,
  DEFAULT_MAX_CONF_RATIO_BPS,
  DEFAULT_MAX_PRICE_AGE_SECS,
  DEFAULT_ORDER_EXPIRATION_TIME_MS,
  DEFAULT_OUTER_BALANCE_BPS,
  DEFAULT_POST_ONLY,
  DEFAULT_STALE_PRICE_TOLERANCE_BPS,
  DEFAULT_VOLATILITY_MULTIPLIER_BPS
} from "@sui-amm/domain-core/models/amm"
import {
  parseNonNegativeU64,
  parsePositiveU64
} from "@sui-amm/tooling-core/utils/utility"
import type {
  AmmConfigFieldErrors,
  AmmConfigFieldKey,
  AmmConfigFormState
} from "../components/AmmConfigForm"
import { resolveValidationMessage } from "./inputValidation"

const MAX_BPS_EXCLUSIVE = 10_000n

type FieldValidator = {
  required: string
  fallbackMessage: string
  parse: (raw: string, label: string) => bigint
  label: string
  maxExclusiveBps?: boolean
}

const FIELD_VALIDATORS: Partial<Record<AmmConfigFieldKey, FieldValidator>> = {
  baseSpreadBps: {
    required: "Base spread is required.",
    fallbackMessage: "Base spread must be a valid u64.",
    parse: parsePositiveU64,
    label: "Base spread bps",
    maxExclusiveBps: true
  },
  volatilityMultiplierBps: {
    required: "Volatility multiplier is required.",
    fallbackMessage: "Volatility multiplier must be a valid u64.",
    parse: parseNonNegativeU64,
    label: "Volatility multiplier bps"
  },
  orderExpirationTimeMs: {
    required: "Order expiration is required.",
    fallbackMessage: "Order expiration must be a valid u64.",
    parse: parsePositiveU64,
    label: "Order expiration time ms"
  },
  maxPriceAgeSecs: {
    required: "Max price age is required.",
    fallbackMessage: "Max price age must be a valid u64.",
    parse: parsePositiveU64,
    label: "Max price age secs"
  },
  maxConfRatioBps: {
    required: "Max conf ratio is required.",
    fallbackMessage: "Max conf ratio must be a valid u64.",
    parse: parsePositiveU64,
    label: "Max conf ratio bps",
    maxExclusiveBps: true
  },
  outerBalanceBps: {
    required: "Outer balance is required.",
    fallbackMessage: "Outer balance must be a valid u64.",
    parse: parseNonNegativeU64,
    label: "Outer balance bps",
    maxExclusiveBps: true
  },
  inventorySkewBps: {
    required: "Inventory skew is required.",
    fallbackMessage: "Inventory skew must be a valid u64.",
    parse: parseNonNegativeU64,
    label: "Inventory skew bps",
    maxExclusiveBps: true
  },
  stalePriceToleranceBps: {
    required: "Stale price tolerance is required.",
    fallbackMessage: "Stale price tolerance must be a valid u64.",
    parse: parseNonNegativeU64,
    label: "Stale price tolerance bps",
    maxExclusiveBps: true
  }
}

const FIELD_KEYS = Object.keys(FIELD_VALIDATORS) as AmmConfigFieldKey[]

export const buildAmmConfigFormState = (
  ammConfig?: AmmConfigOverview
): AmmConfigFormState => ({
  baseSpreadBps: ammConfig?.baseSpreadBps ?? DEFAULT_BASE_SPREAD_BPS,
  volatilityMultiplierBps:
    ammConfig?.volatilityMultiplierBps ?? DEFAULT_VOLATILITY_MULTIPLIER_BPS,
  orderExpirationTimeMs:
    ammConfig?.orderExpirationTimeMs ?? DEFAULT_ORDER_EXPIRATION_TIME_MS,
  maxPriceAgeSecs: ammConfig?.maxPriceAgeSecs ?? DEFAULT_MAX_PRICE_AGE_SECS,
  maxConfRatioBps: ammConfig?.maxConfRatioBps ?? DEFAULT_MAX_CONF_RATIO_BPS,
  outerBalanceBps: ammConfig?.outerBalanceBps ?? DEFAULT_OUTER_BALANCE_BPS,
  inventorySkewBps: ammConfig?.inventorySkewBps ?? DEFAULT_INVENTORY_SKEW_BPS,
  stalePriceToleranceBps:
    ammConfig?.stalePriceToleranceBps ?? DEFAULT_STALE_PRICE_TOLERANCE_BPS,
  postOnly:
    ammConfig?.postOnly !== undefined
      ? String(ammConfig.postOnly)
      : DEFAULT_POST_ONLY
})

const validateField = (
  key: AmmConfigFieldKey,
  rawValue: string
): string | undefined => {
  const validator = FIELD_VALIDATORS[key]
  if (!validator) return undefined
  const trimmed = rawValue.trim()
  if (!trimmed) return validator.required
  try {
    const parsed = validator.parse(trimmed, validator.label)
    if (validator.maxExclusiveBps && parsed >= MAX_BPS_EXCLUSIVE) {
      return `${validator.label} must be less than ${MAX_BPS_EXCLUSIVE.toString()}.`
    }
    return undefined
  } catch (error) {
    return resolveValidationMessage(error, validator.fallbackMessage)
  }
}

// Mirrors the Move-side `EOrderExpirationExceedsPriceAge` invariant in
// `config::new`: order TTL must not exceed the oracle freshness window, or an
// order can stay live priced against stale Pyth data.
const validateOrderExpirationVsPriceAge = (
  formState: AmmConfigFormState
): { orderExpirationTimeMs?: string; maxPriceAgeSecs?: string } => {
  try {
    const orderExpirationTimeMs = parsePositiveU64(
      formState.orderExpirationTimeMs.trim(),
      "Order expiration time ms"
    )
    const maxPriceAgeSecs = parsePositiveU64(
      formState.maxPriceAgeSecs.trim(),
      "Max price age secs"
    )
    if (orderExpirationTimeMs > maxPriceAgeSecs * 1000n) {
      const message = `Order expiration (${orderExpirationTimeMs.toString()} ms) must be ≤ Max price age × 1000 (${(maxPriceAgeSecs * 1000n).toString()} ms).`
      return {
        orderExpirationTimeMs: message,
        maxPriceAgeSecs: message
      }
    }
    return {}
  } catch {
    // Per-field validators already report the parse failure; skip the
    // cross-field check until both inputs are individually valid.
    return {}
  }
}

export const buildAmmConfigFieldErrors = (
  formState: AmmConfigFormState
): AmmConfigFieldErrors => {
  const errors: AmmConfigFieldErrors = {}
  for (const key of FIELD_KEYS) {
    const error = validateField(key, formState[key])
    if (error) errors[key] = error
  }

  const crossFieldErrors = validateOrderExpirationVsPriceAge(formState)
  if (crossFieldErrors.orderExpirationTimeMs && !errors.orderExpirationTimeMs) {
    errors.orderExpirationTimeMs = crossFieldErrors.orderExpirationTimeMs
  }
  if (crossFieldErrors.maxPriceAgeSecs && !errors.maxPriceAgeSecs) {
    errors.maxPriceAgeSecs = crossFieldErrors.maxPriceAgeSecs
  }

  return errors
}
