// Devnet/testnet/mainnet contract package ids stay env-driven because those
// deploys happen independently of the `dapp` artifact files. Localnet ids
// (contract, deepbook, mock pyth) come from `packages/dapp/deployments/` at
// runtime via `useDeploymentArtifacts` — no manual `.env` edits.
export const CONTRACT_PACKAGE_ID_UNDEFINED = "0xUNDEFINED"
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

export const LOCALNET_EXPLORER_URL = "http://localhost:9001"
export const DEVNET_EXPLORER_URL = "https://devnet.suivision.xyz"
export const TESTNET_EXPLORER_URL = "https://testnet.suivision.xyz"
export const MAINNET_EXPLORER_URL = "https://suivision.xyz"

export const CONTRACT_PACKAGE_VARIABLE_NAME = "contractPackageId"

export const CONTRACT_MODULE_NAME = "amm"

export const EXPLORER_URL_VARIABLE_NAME = "explorerUrl"

export const NETWORKS_WITH_FAUCET = ["localnet", "devnet", "testnet"]
