import type * as DomainAmmModule from "@sui-amm/domain-node/amm"
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
const domainAmmMocks = vi.hoisted(() => ({
  resolveAmmAdminCapId: vi.fn(),
  resolveOwnedAmmAdminCapId: vi.fn()
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

vi.mock("@sui-amm/domain-node/amm", async (importOriginal) => ({
  ...(await importOriginal<typeof DomainAmmModule>()),
  resolveAmmAdminCapId: domainAmmMocks.resolveAmmAdminCapId,
  resolveOwnedAmmAdminCapId: domainAmmMocks.resolveOwnedAmmAdminCapId
}))

import {
  DEFAULT_LOCALNET_PYTH_PRICE_FEED_ID,
  resolveAmmAdminCapIdFromArtifacts,
  resolvePythPriceFeedIdHex,
  resolveSignerAmmAdminCapId
} from "../amm.ts"

type AdminCapTooling = Parameters<
  typeof resolveSignerAmmAdminCapId
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
    domainAmmMocks.resolveAmmAdminCapId.mockReset()
    domainAmmMocks.resolveOwnedAmmAdminCapId.mockReset()
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
        objectType: "0x1::executor::AdminCap",
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
          "0x0000000000000000000000000000000000000000000000000000000000000001::executor::AdminCap"
      }
    ])

    const resolved = await resolveAmmAdminCapIdFromArtifacts({
      tooling: createAdminCapTooling(),
      ammPackageId: "0x1"
    })

    expect(resolved).toBe("0xdef")
  })

  it("fails clearly when object artifacts cannot resolve the admin cap", async () => {
    artifactMocks.loadObjectArtifacts.mockResolvedValue([])

    await expect(
      resolveAmmAdminCapIdFromArtifacts({
        tooling: createAdminCapTooling(),
        ammPackageId: "0x1"
      })
    ).rejects.toThrow(
      "Unable to resolve the AMM admin cap from object artifacts; provide --admin-cap-id or re-run amm-create to refresh deployments."
    )
  })
})

describe("resolveSignerAmmAdminCapId", () => {
  beforeEach(() => {
    domainAmmMocks.resolveAmmAdminCapId.mockReset()
    domainAmmMocks.resolveOwnedAmmAdminCapId.mockReset()
  })

  it("prefers an explicit admin cap id when one is provided", async () => {
    domainAmmMocks.resolveAmmAdminCapId.mockResolvedValue("0xexplicit")

    const resolved = await resolveSignerAmmAdminCapId({
      tooling: createAdminCapTooling(),
      ammPackageId: "0x1",
      signerAddress: "0x2",
      adminCapId: " 0xexplicit "
    })

    expect(resolved).toBe("0xexplicit")
    expect(domainAmmMocks.resolveAmmAdminCapId).toHaveBeenCalledWith({
      networkName: "localnet",
      adminCapId: "0xexplicit"
    })
    expect(domainAmmMocks.resolveOwnedAmmAdminCapId).not.toHaveBeenCalled()
  })

  it("reuses an admin cap owned by the signer when no explicit id is provided", async () => {
    domainAmmMocks.resolveOwnedAmmAdminCapId.mockResolvedValue("0xowned")

    const resolved = await resolveSignerAmmAdminCapId({
      tooling: createAdminCapTooling(),
      ammPackageId: "0x1",
      signerAddress: "0x2"
    })

    expect(resolved).toBe("0xowned")
    expect(domainAmmMocks.resolveOwnedAmmAdminCapId).toHaveBeenCalledWith({
      ammPackageId: "0x1",
      ownerAddress: "0x2",
      suiClient: expect.any(Object)
    })
    expect(domainAmmMocks.resolveAmmAdminCapId).not.toHaveBeenCalled()
  })

  it("fails clearly when the signer does not own an admin cap and none is provided explicitly", async () => {
    domainAmmMocks.resolveOwnedAmmAdminCapId.mockResolvedValue(undefined)

    await expect(
      resolveSignerAmmAdminCapId({
        tooling: createAdminCapTooling(),
        ammPackageId: "0x1",
        signerAddress: "0x2"
      })
    ).rejects.toThrow(
      "No AMM admin capability found for signer 0x2. Provide --admin-cap-id or use a signer that owns 0x0000000000000000000000000000000000000000000000000000000000000001::executor::AdminCap."
    )
  })
})
