// We automatically create/update .env.local with the deployed package ID after deployment.
export const CONTRACT_PACKAGE_ID_UNDEFINED = "0xUNDEFINED"
export const LOCALNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_UNDEFINED
export const LOCALNET_RPC_URL = "http://127.0.0.1:9000"
export const DEVNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_DEVNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_UNDEFINED
export const TESTNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_UNDEFINED
export const MAINNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_MAINNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_UNDEFINED
export const LOCALNET_DEEPBOOK_REGISTRY_ID =
  process.env.NEXT_PUBLIC_LOCALNET_DEEPBOOK_REGISTRY_ID
export const LOCALNET_DEEPBOOK_PACKAGE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_DEEPBOOK_PACKAGE_ID

// Localnet-only mock Pyth artifacts used by the Refresh Quotes flow on
// /bot. The mock Pyth `State` mirrors real Pyth's feed registry, so
// `SuiPythClient.getPriceFeedObjectId(feedIdHex)` resolves a `PriceInfoObject`
// the same way it does on mainnet/testnet — no per-feed pinning needed.
export const LOCALNET_PYTH_MOCK_PACKAGE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_PYTH_MOCK_PACKAGE_ID
export const LOCALNET_PYTH_STATE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_PYTH_STATE_ID

export const LOCALNET_EXPLORER_URL = "http://localhost:9001"
export const DEVNET_EXPLORER_URL = "https://devnet.suivision.xyz"
export const TESTNET_EXPLORER_URL = "https://testnet.suivision.xyz"
export const MAINNET_EXPLORER_URL = "https://suivision.xyz"

export const CONTRACT_PACKAGE_VARIABLE_NAME = "contractPackageId"

export const CONTRACT_MODULE_NAME = "amm"

export const EXPLORER_URL_VARIABLE_NAME = "explorerUrl"

export const NETWORKS_WITH_FAUCET = ["localnet", "devnet", "testnet"]
