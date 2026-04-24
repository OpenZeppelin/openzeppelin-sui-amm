import { normalizeSuiObjectId } from "@mysten/sui/utils"

export const validateSuiObjectId = (
  rawValue: string,
  label: string
): string | undefined => {
  const trimmed = rawValue.trim()
  if (!trimmed) return `${label} is required.`
  try {
    normalizeSuiObjectId(trimmed)
    return undefined
  } catch {
    return `${label} must be a valid Sui object ID.`
  }
}
