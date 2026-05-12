import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { ObjectArtifact } from "@sui-amm/tooling-core/object"
import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { withCwd } from "../../../test-helpers/helpers/cwd.ts"
import {
  readTextFile,
  withTempDir,
  writeFileTree
} from "../../../test-helpers/helpers/fs.ts"
import {
  findLatestArtifactThat,
  getDeploymentArtifactPath,
  getLatestArtifact,
  getLatestDeploymentFromArtifact,
  getLatestObjectFromArtifact,
  getObjectArtifactPath,
  readArtifact,
  resolvePublisherCapIdFromObjectArtifacts,
  writeArtifact,
  writeObjectArtifact
} from "../../src/artifacts.ts"
import {
  findPublishedPackageIdByName,
  isPublishArtifactNamed,
  pickRootNonDependencyArtifact
} from "../../src/package.ts"

describe("pickRootNonDependencyArtifact", () => {
  it("selects the first non-dependency artifact", () => {
    const artifacts = [
      { packageId: "0x1", isDependency: true },
      { packageId: "0x2", isDependency: false }
    ] as PublishArtifact[]

    expect(pickRootNonDependencyArtifact(artifacts).packageId).toBe("0x2")
  })

  it("throws when artifacts are empty", () => {
    expect(() => pickRootNonDependencyArtifact([])).toThrow(
      "No artifacts to select from."
    )
  })
})

describe("writeObjectArtifact", () => {
  it("dedupes by objectId and keeps the latest entry", async () => {
    await withTempDir(async (dir) => {
      const artifactPath = path.join(dir, "objects.json")
      const first: ObjectArtifact[] = [
        { objectId: "0x1", packageId: "0x2", signer: "0x3", objectType: "A" }
      ]
      const second: ObjectArtifact[] = [
        { objectId: "0x1", packageId: "0x2", signer: "0x3", objectType: "B" }
      ]

      await writeObjectArtifact(artifactPath, first)
      const merged = await writeObjectArtifact(artifactPath, second)

      expect(merged).toHaveLength(1)
      expect(merged[0]?.objectType).toBe("B")
    })
  })
})

describe("writeArtifact", () => {
  it("merges and dedupes mock artifact arrays instead of overwriting them", async () => {
    await withTempDir(async (dir) => {
      const artifactPath = path.join(dir, "mock.json")
      const writeMockArtifact = writeArtifact<{
        coins?: {
          label: string
          coinType: string
          currencyObjectId: string
          treasuryCapId?: string
          mintedCoinObjectId?: string
        }[]
        priceFeeds?: {
          label: string
          feedIdHex: string
          priceInfoObjectId: string
        }[]
      }>({})

      await writeMockArtifact(artifactPath, {
        coins: [
          {
            label: "USDC",
            coinType: "0x1::usdc::USDC",
            currencyObjectId: "0x1",
            treasuryCapId: "0xtreasury"
          }
        ],
        priceFeeds: [
          {
            label: "BTC/USD",
            feedIdHex: "0xfeed-1",
            priceInfoObjectId: "0xa"
          }
        ]
      })

      const merged = await writeMockArtifact(artifactPath, {
        coins: [
          {
            label: "USDC",
            coinType: "0x1::usdc::USDC",
            currencyObjectId: "0x2",
            mintedCoinObjectId: "0xminted"
          },
          {
            label: "SUI",
            coinType: "0x2::sui::SUI",
            currencyObjectId: "0x3"
          }
        ],
        priceFeeds: [
          {
            label: "BTC/USD",
            feedIdHex: "0xfeed-1",
            priceInfoObjectId: "0xb"
          },
          {
            label: "ETH/USD",
            feedIdHex: "0xfeed-2",
            priceInfoObjectId: "0xc"
          }
        ]
      })

      expect(merged).toEqual({
        coins: [
          {
            label: "USDC",
            coinType: "0x1::usdc::USDC",
            currencyObjectId: "0x2",
            treasuryCapId: "0xtreasury",
            mintedCoinObjectId: "0xminted"
          },
          {
            label: "SUI",
            coinType: "0x2::sui::SUI",
            currencyObjectId: "0x3"
          }
        ],
        priceFeeds: [
          {
            label: "BTC/USD",
            feedIdHex: "0xfeed-1",
            priceInfoObjectId: "0xb"
          },
          {
            label: "ETH/USD",
            feedIdHex: "0xfeed-2",
            priceInfoObjectId: "0xc"
          }
        ]
      })
    })
  })
})

describe("readArtifact", () => {
  it("creates the file with defaults when missing", async () => {
    await withTempDir(async (dir) => {
      const artifactPath = path.join(dir, "deployment.json")
      const defaults: PublishArtifact[] = []

      const result = await readArtifact(artifactPath, defaults)
      const persisted = JSON.parse(await readTextFile(artifactPath))

      expect(result).toEqual(defaults)
      expect(persisted).toEqual(defaults)
    })
  })
})

describe("latest artifact helpers", () => {
  it("returns latest artifact by publishedAt when available", () => {
    const artifacts = [
      { packageId: "0x1", publishedAt: "2024-01-01T00:00:00Z" },
      { packageId: "0x2", publishedAt: "2024-01-02T00:00:00Z" }
    ] as PublishArtifact[]

    expect(getLatestArtifact(artifacts)?.packageId).toBe("0x2")
  })

  it("returns latest artifact that matches predicate", () => {
    const artifacts = [
      {
        packageId: "0x1",
        packageName: "foo",
        publishedAt: "2024-01-01T00:00:00Z"
      },
      {
        packageId: "0x2",
        packageName: "bar",
        publishedAt: "2024-01-02T00:00:00Z"
      }
    ] as PublishArtifact[]

    const match = findLatestArtifactThat(
      (artifact) => artifact.packageName === "bar",
      artifacts
    )

    expect(match?.packageId).toBe("0x2")
  })
})

describe("artifact path helpers", () => {
  it("normalizes object/deployment artifacts from disk", async () => {
    await withTempDir(async (dir) => {
      const networkName = "localnet"
      await withCwd(dir, async () => {
        const objectArtifactPath = getObjectArtifactPath(networkName)
        const deploymentArtifactPath = getDeploymentArtifactPath(networkName)

        const objectArtifacts = [
          {
            packageId: "0x2",
            signer: "0x3",
            objectId: "0x4",
            objectType: "0x2::module::Struct"
          }
        ]
        const deploymentArtifacts = [
          {
            packageId: "0x5",
            packageName: "oracle-market",
            packagePath: "/tmp/contracts/oracle-market",
            publishedAt: "2024-01-01T00:00:00Z"
          }
        ]

        await writeFileTree(dir, {
          [path.relative(dir, objectArtifactPath)]: JSON.stringify(
            objectArtifacts,
            undefined,
            2
          ),
          [path.relative(dir, deploymentArtifactPath)]: JSON.stringify(
            deploymentArtifacts,
            undefined,
            2
          )
        })

        const latestObject =
          await getLatestObjectFromArtifact("::Struct")(networkName)
        const latestDeployment =
          await getLatestDeploymentFromArtifact("oracle-market")(networkName)

        expect(latestObject?.objectId).toBe(normalizeSuiObjectId("0x4"))
        expect(latestDeployment?.packageId).toBe(normalizeSuiObjectId("0x5"))
      })
    })
  })
})

describe("isPublishArtifactNamed", () => {
  it("matches by normalized package name or path", () => {
    const matcher = isPublishArtifactNamed("oracle-market")

    expect(
      matcher({
        packageName: "Oracle-Market",
        packagePath: "/tmp/contracts/oracle-market"
      } as PublishArtifact)
    ).toBe(true)
  })
})

describe("findPublishedPackageIdByName", () => {
  it("returns the published package id for a matching package name", () => {
    const artifacts = [
      {
        packageId: "0x1",
        packageName: "pyth"
      },
      {
        packageId: "0x2",
        packageName: "sui_oracle_market"
      }
    ] as PublishArtifact[]

    expect(findPublishedPackageIdByName(artifacts, "PYTH")).toBe("0x1")
  })

  it("returns undefined when no package name matches", () => {
    const artifacts = [
      {
        packageId: "0x1",
        packageName: "sui_oracle_market"
      }
    ] as PublishArtifact[]

    expect(findPublishedPackageIdByName(artifacts, "pyth")).toBeUndefined()
  })
})

describe("resolvePublisherCapIdFromObjectArtifacts", () => {
  it("returns the publisher object id for a digest", async () => {
    await withTempDir(async (dir) => {
      const networkName = "localnet"
      await withCwd(dir, async () => {
        const objectArtifactPath = getObjectArtifactPath(networkName)
        const objectArtifacts = [
          {
            packageId: "0x1",
            signer: "0x2",
            objectId: "0x3",
            objectType: "0x2::package::Publisher",
            digest: "digest-123"
          }
        ]

        await writeFileTree(dir, {
          [path.relative(dir, objectArtifactPath)]: JSON.stringify(
            objectArtifacts,
            undefined,
            2
          )
        })

        const publisherId = await resolvePublisherCapIdFromObjectArtifacts({
          networkName,
          publishDigest: "digest-123"
        })

        expect(publisherId).toBe("0x3")
      })
    })
  })
})
