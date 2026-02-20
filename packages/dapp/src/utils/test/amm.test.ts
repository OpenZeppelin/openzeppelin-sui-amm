import type * as ArtifactsModule from "@sui-amm/tooling-node/artifacts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const artifactMocks = vi.hoisted(() => ({
  readArtifact: vi.fn()
}))

const pythMocks = vi.hoisted(() => ({
  findMockPriceFeedConfig: vi.fn()
}))

const logMocks = vi.hoisted(() => ({
  logWarning: vi.fn(),
  logKeyValueGreen: vi.fn(() => vi.fn())
}))

vi.mock("@sui-amm/tooling-node/artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArtifactsModule>()),
  readArtifact: artifactMocks.readArtifact
}))

vi.mock("@sui-amm/domain-core/models/pyth", () => ({
  findMockPriceFeedConfig: pythMocks.findMockPriceFeedConfig
}))

vi.mock("@sui-amm/tooling-node/log", () => ({
  logWarning: logMocks.logWarning,
  logKeyValueGreen: logMocks.logKeyValueGreen
}))

import { resolvePythPriceFeedIdHex } from "../amm.ts"

describe("resolvePythPriceFeedIdHex", () => {
  beforeEach(() => {
    artifactMocks.readArtifact.mockReset()
    pythMocks.findMockPriceFeedConfig.mockReset()
    logMocks.logWarning.mockReset()
  })

  it("returns a trimmed explicit feed id", async () => {
    const resolved = await resolvePythPriceFeedIdHex({
      networkName: "testnet",
      pythPriceFeedId: " 0xabc "
    })

    expect(resolved).toBe("0xabc")
    expect(artifactMocks.readArtifact).not.toHaveBeenCalled()
    expect(pythMocks.findMockPriceFeedConfig).not.toHaveBeenCalled()
  })

  it("throws on shared networks without an explicit feed id", async () => {
    await expect(
      resolvePythPriceFeedIdHex({ networkName: "devnet" })
    ).rejects.toThrow(
      "Pyth price feed id is required; provide --pyth-price-feed-id when targeting shared networks."
    )

    expect(artifactMocks.readArtifact).not.toHaveBeenCalled()
  })

  it("prefers mock artifact feed ids on localnet", async () => {
    artifactMocks.readArtifact.mockResolvedValue({
      priceFeeds: [
        {
          label: "CUSTOM_FEED",
          feedIdHex: "0xfeed",
          priceInfoObjectId: "0xprice"
        }
      ]
    })

    const resolved = await resolvePythPriceFeedIdHex({
      networkName: "localnet",
      pythPriceFeedLabel: "CUSTOM_FEED"
    })

    expect(resolved).toBe("0xfeed")
    expect(pythMocks.findMockPriceFeedConfig).not.toHaveBeenCalled()
    expect(logMocks.logWarning).not.toHaveBeenCalled()
  })

  it("falls back to default mocks when artifacts are missing", async () => {
    artifactMocks.readArtifact.mockResolvedValue({ priceFeeds: [] })
    pythMocks.findMockPriceFeedConfig.mockReturnValue({
      label: "MOCK_SUI_FEED",
      feedIdHex: "0xfallback",
      price: 1n,
      confidence: 1n,
      exponent: 0
    })

    const resolved = await resolvePythPriceFeedIdHex({
      networkName: "localnet"
    })

    expect(resolved).toBe("0xfallback")
    expect(logMocks.logWarning).toHaveBeenCalledWith(
      "No localnet mock feed artifacts found for MOCK_SUI_FEED; using default mock feed id."
    )
  })

  it("throws when no feed id can be resolved", async () => {
    artifactMocks.readArtifact.mockResolvedValue({ priceFeeds: [] })
    pythMocks.findMockPriceFeedConfig.mockReturnValue(undefined)

    await expect(
      resolvePythPriceFeedIdHex({ networkName: "localnet" })
    ).rejects.toThrow(
      "Unable to resolve a Pyth price feed id. Run the mock setup script or provide --pyth-price-feed-id."
    )
  })
})
