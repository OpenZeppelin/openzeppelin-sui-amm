import { getArtifactPath, writeArtifact } from "@sui-amm/tooling-node/artifacts"
import path from "node:path"

export type MockArtifact = Partial<{
  pythPackageId: string
  coinPackageId: string
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

export const DEFAULT_PYTH_CONTRACT_PATH = path.join(
  process.cwd(),
  "move",
  "pyth-mock"
)
export const DEFAULT_COIN_CONTRACT_PATH = path.join(
  process.cwd(),
  "move",
  "coin-mock"
)
