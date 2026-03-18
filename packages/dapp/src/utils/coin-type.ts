import { normalizeCoinType } from "@sui-amm/tooling-core/coin"

const COIN_OBJECT_TYPE_PREFIX = "::coin::Coin<"

const buildInvalidAssetTypeArgumentError = ({
  valueLabel,
  value
}: {
  valueLabel: string
  value: string
}) =>
  new Error(`${valueLabel} ${value} is missing a valid asset type argument.`)

const resolveGenericTypeArgument = ({
  value,
  genericTypeStartIndex,
  valueLabel
}: {
  value: string
  genericTypeStartIndex: number
  valueLabel: string
}) => {
  let genericDepth = 1

  for (
    let currentIndex = genericTypeStartIndex;
    currentIndex < value.length;
    currentIndex += 1
  ) {
    const currentCharacter = value[currentIndex]
    if (currentCharacter === "<") {
      genericDepth += 1
      continue
    }

    if (currentCharacter !== ">") continue

    genericDepth -= 1
    if (genericDepth !== 0) continue

    const resolvedTypeArgument = value
      .slice(genericTypeStartIndex, currentIndex)
      .trim()
    const trailingValue = value.slice(currentIndex + 1).trim()
    if (!resolvedTypeArgument || trailingValue.length > 0) {
      throw buildInvalidAssetTypeArgumentError({
        valueLabel,
        value
      })
    }

    return resolvedTypeArgument
  }

  throw buildInvalidAssetTypeArgumentError({
    valueLabel,
    value
  })
}

export const extractCoinAssetTypeFromCoinObjectType = ({
  coinObjectType,
  valueLabel
}: {
  coinObjectType: string
  valueLabel: string
}) => {
  const trimmedCoinObjectType = coinObjectType.trim()
  const coinObjectTypePrefixIndex = trimmedCoinObjectType.indexOf(
    COIN_OBJECT_TYPE_PREFIX
  )
  if (coinObjectTypePrefixIndex < 0) {
    throw new Error(`${valueLabel} ${coinObjectType} is not a Coin<T> type.`)
  }

  const genericTypeStartIndex =
    coinObjectTypePrefixIndex + COIN_OBJECT_TYPE_PREFIX.length
  return normalizeCoinType(
    resolveGenericTypeArgument({
      value: trimmedCoinObjectType,
      genericTypeStartIndex,
      valueLabel
    })
  )
}

export const resolveCoinAssetTypeFromInput = ({
  coinTypeInput,
  valueLabel
}: {
  coinTypeInput: string
  valueLabel: string
}) => {
  const trimmedCoinTypeInput = coinTypeInput.trim()
  const coinObjectTypePrefixIndex = trimmedCoinTypeInput.indexOf(
    COIN_OBJECT_TYPE_PREFIX
  )
  if (coinObjectTypePrefixIndex < 0) {
    return normalizeCoinType(trimmedCoinTypeInput)
  }

  return extractCoinAssetTypeFromCoinObjectType({
    coinObjectType: trimmedCoinTypeInput,
    valueLabel
  })
}
