import { deriveCurrencyObjectId } from "@sui-amm/tooling-core/coin-registry"
import { SUI_COIN_REGISTRY_ID } from "@sui-amm/tooling-core/constants"

export const resolveCurrencyRegistryId = (coinType: string) => {
  try {
    return deriveCurrencyObjectId(coinType, SUI_COIN_REGISTRY_ID)
  } catch {
    return undefined
  }
}
