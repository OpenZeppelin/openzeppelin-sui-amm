import type * as ArtifactsModule from "@sui-amm/tooling-node/artifacts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const artifactMocks = vi.hoisted(() => ({
  readArtifact: vi.fn()
}))

const logMocks = vi.hoisted(() => ({
  logWarning: vi.fn(),
  logKeyValueGreen: vi.fn(() => vi.fn())
}))

vi.mock("@sui-amm/tooling-node/artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArtifactsModule>()),
  readArtifact: artifactMocks.readArtifact
}))

vi.mock("@sui-amm/tooling-node/log", () => ({
  logWarning: logMocks.logWarning,
  logKeyValueGreen: logMocks.logKeyValueGreen
}))

import {
  DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID,
  resolvePythPriceFeedIdHex
} from "../amm.ts"

describe("resolvePythPriceFeedIdHex", () => {
  beforeEach(() => {
    artifactMocks.readArtifact.mockReset()
    logMocks.logWarning.mockReset()
  })

  it("returns a trimmed explicit feed id", async () => {
    const resolved = await resolvePythPriceFeedIdHex({
      networkName: "testnet",
      pythPriceFeedId: " 0xabc "
    })

    expect(resolved).toBe("0xabc")
    expect(artifactMocks.readArtifact).not.toHaveBeenCalled()
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
    expect(logMocks.logWarning).not.toHaveBeenCalled()
  })

  it("falls back to a deterministic localnet feed id when artifacts are missing", async () => {
    artifactMocks.readArtifact.mockResolvedValue({ priceFeeds: [] })

    const resolved = await resolvePythPriceFeedIdHex({
      networkName: "localnet"
    })

    expect(resolved).toBe(DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID)
    expect(logMocks.logWarning).toHaveBeenCalledWith(
      "No localnet feed artifact found for MOCK_SUI_FEED; using a deterministic placeholder feed id."
    )
  })

  it("falls back to the deterministic localnet feed id when the requested label is unavailable", async () => {
    artifactMocks.readArtifact.mockResolvedValue({ priceFeeds: [] })

    const resolved = await resolvePythPriceFeedIdHex({
      networkName: "localnet",
      pythPriceFeedLabel: "UNKNOWN_FEED"
    })

    expect(resolved).toBe(DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID)
    expect(logMocks.logWarning).toHaveBeenCalledWith(
      "No localnet feed artifact found for UNKNOWN_FEED; using a deterministic placeholder feed id."
    )
  })
})
