import { getArtifactPath, writeArtifact } from "@sui-amm/tooling-node/artifacts"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type MockArtifact = Partial<{
  pythPackageId: string
  coinPackageId: string
  deepbookPackageId: string
  deepbookTokenPackageId: string
  deepbookRegistryId: string
  deepbookAdminCapId: string
  priceFeeds: {
    label: string
    feedIdHex: string
    priceInfoObjectId: string
  }[]
  coins: {
    label: string
    coinType: string
    currencyObjectId: string
    treasuryCapId?: string
    metadataObjectId?: string
    mintedCoinObjectId?: string
  }[]
}>

export type CoinArtifact = NonNullable<MockArtifact["coins"]>[number]
export type PriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number]

/**
 * Persists mock deployment state (packages, coins, price feeds) to disk.
 * This lets repeated localnet runs reuse published mocks instead of republishing every time.
 */
export const writeMockArtifact = writeArtifact<MockArtifact>({})

export const mockArtifactPath = getArtifactPath("mock")("localnet")

const resolveDappRootPath = () =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const resolveWorkspaceRootPath = () =>
  path.resolve(resolveDappRootPath(), "..", "..")

const resolveDefaultDappMoveRootPath = () => {
  const contractsPath = path.join(resolveDappRootPath(), "contracts")
  if (fs.existsSync(contractsPath)) return contractsPath
  return path.join(resolveDappRootPath(), "move")
}

const resolveDefaultDappContractPath = (contractName: string) =>
  path.join(resolveDefaultDappMoveRootPath(), contractName)

export const DEFAULT_PYTH_CONTRACT_PATH =
  resolveDefaultDappContractPath("pyth-mock")

export const DEFAULT_COIN_CONTRACT_PATH =
  resolveDefaultDappContractPath("coin-mock")

export const DEFAULT_DEEPBOOK_PATH = path.resolve(
  resolveWorkspaceRootPath(),
  "vendor",
  "deepbookv3",
  "packages",
  "deepbook"
)

export const DEFAULT_DEEPBOOK_TOKEN_PATH = path.resolve(
  resolveWorkspaceRootPath(),
  "vendor",
  "deepbookv3",
  "packages",
  "token"
)

export const resolveDeepbookContractPathSync = ({
  basePath,
  allowMissing = false
}: {
  basePath: string
  allowMissing?: boolean
}) => {
  const deepbookPath = path.resolve(
    basePath,
    "vendor",
    "deepbookv3",
    "packages",
    "deepbook"
  )

  if (fs.existsSync(deepbookPath)) return deepbookPath
  if (allowMissing) return undefined

  throw new Error(
    `DeepBook contract path was not found at ${deepbookPath}. Re-run with --deepbook-contract-path.`
  )
}
