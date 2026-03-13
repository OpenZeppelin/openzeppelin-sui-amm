import type * as ArtifactsModule from "@sui-amm/tooling-node/artifacts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const artifactMocks = vi.hoisted(() => ({
  readArtifact: vi.fn(),
  loadDeploymentArtifacts: vi.fn(),
  loadObjectArtifacts: vi.fn()
}))
const logMocks = vi.hoisted(() => ({
  logWarning: vi.fn(),
  logKeyValueGreen: vi.fn(() => vi.fn())
}))

vi.mock("@sui-amm/tooling-node/artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArtifactsModule>()),
  readArtifact: artifactMocks.readArtifact,
  loadDeploymentArtifacts: artifactMocks.loadDeploymentArtifacts,
  loadObjectArtifacts: artifactMocks.loadObjectArtifacts
}))

vi.mock("@sui-amm/tooling-node/log", () => ({
  logWarning: logMocks.logWarning,
  logKeyValueGreen: logMocks.logKeyValueGreen
}))

import {
  DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID,
  resolveAmmAdminCapIdFromArtifacts,
  resolvePythPriceFeedIdHex
} from "../amm.ts"

type AdminCapTooling = Parameters<
  typeof resolveAmmAdminCapIdFromArtifacts
>[0]["tooling"]

const createAdminCapTooling = ({
  getTransactionBlock = vi.fn()
}: {
  getTransactionBlock?: ReturnType<typeof vi.fn>
} = {}): AdminCapTooling =>
  ({
    network: {
      networkName: "localnet",
      url: "http://127.0.0.1:9000",
      account: {}
    },
    suiClient: {
      getTransactionBlock
    }
  }) as unknown as AdminCapTooling

describe("resolvePythPriceFeedIdHex", () => {
  beforeEach(() => {
    artifactMocks.readArtifact.mockReset()
    artifactMocks.loadDeploymentArtifacts.mockReset()
    artifactMocks.loadObjectArtifacts.mockReset()
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

  it("falls back to the deterministic localnet feed id when the mock artifact cannot be read", async () => {
    artifactMocks.readArtifact.mockRejectedValue(
      new Error("mock artifact is malformed")
    )

    const resolved = await resolvePythPriceFeedIdHex({
      networkName: "localnet"
    })

    expect(resolved).toBe(DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID)
    expect(logMocks.logWarning).toHaveBeenCalledWith(
      "No localnet feed artifact found for MOCK_SUI_FEED; using a deterministic placeholder feed id."
    )
  })
})

describe("resolveAmmAdminCapIdFromArtifacts", () => {
  beforeEach(() => {
    artifactMocks.loadDeploymentArtifacts.mockReset()
    artifactMocks.loadObjectArtifacts.mockReset()
    logMocks.logWarning.mockReset()
  })

  it("returns the admin cap from object artifacts that match the latest publish digest", async () => {
    artifactMocks.loadDeploymentArtifacts.mockResolvedValue([
      {
        packageId: "0x1",
        digest: "digest-123"
      }
    ])
    artifactMocks.loadObjectArtifacts.mockResolvedValue([
      {
        packageId: "0x1",
        signer: "0x2",
        objectId: "0xabc",
        objectType: "0x1::manager::AMMAdminCap",
        digest: "digest-123"
      }
    ])

    const getTransactionBlock = vi.fn()

    const resolved = await resolveAmmAdminCapIdFromArtifacts({
      tooling: createAdminCapTooling({ getTransactionBlock }),
      ammPackageId: "0x1"
    })

    expect(resolved).toBe("0xabc")
    expect(getTransactionBlock).not.toHaveBeenCalled()
  })

  it("falls back to object artifacts that match the package id when the publish digest is unavailable", async () => {
    artifactMocks.loadDeploymentArtifacts.mockResolvedValue([])
    artifactMocks.loadObjectArtifacts.mockResolvedValue([
      {
        packageId:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        signer: "0x2",
        objectId: "0xdef",
        objectType:
          "0x0000000000000000000000000000000000000000000000000000000000000001::manager::AMMAdminCap"
      }
    ])

    const resolved = await resolveAmmAdminCapIdFromArtifacts({
      tooling: createAdminCapTooling(),
      ammPackageId: "0x1"
    })

    expect(resolved).toBe("0xdef")
  })

  it("logs and fails clearly when neither transaction lookup nor object artifacts can resolve the admin cap", async () => {
    artifactMocks.loadDeploymentArtifacts.mockResolvedValue([
      {
        packageId: "0x1",
        digest: "digest-123"
      }
    ])
    artifactMocks.loadObjectArtifacts.mockResolvedValue([])
    const getTransactionBlock = vi
      .fn()
      .mockRejectedValue(new Error("transaction lookup failed"))

    await expect(
      resolveAmmAdminCapIdFromArtifacts({
        tooling: createAdminCapTooling({ getTransactionBlock }),
        ammPackageId: "0x1"
      })
    ).rejects.toThrow(
      "Unable to resolve the AMM admin cap from the latest publish transaction or object artifacts; provide --admin-cap-id or re-run publish to refresh deployments."
    )

    expect(logMocks.logWarning).toHaveBeenCalledWith(
      "Unable to recover the AMM admin cap from publish digest digest-123: transaction lookup failed"
    )
  })
})
