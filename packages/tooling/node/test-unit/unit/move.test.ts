import type { PublishArtifact } from "@sui-amm/tooling-core/types"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  readTextFile,
  withTempDir,
  writeFileTree
} from "../../../test-helpers/helpers/fs.ts"
import { MOVE_TOML, PUBLISHED_TOML } from "../../../test-helpers/fixtures.ts"
import {
  buildMoveEnvironmentFlags,
  buildMoveTestArguments,
  buildMoveTestPublishArguments,
  canonicalizePackagePath,
  clearPublishedEntryForNetwork,
  hasDeploymentForPackage,
  readMoveTomlDependencyReplacement,
  resolveFullPackagePath,
  syncMoveEnvironmentChainId,
  syncMoveTomlDependencyReplacementEntry,
  syncMoveTomlDependencyPublishedIds
} from "../../src/move.ts"

describe("move helpers", () => {
  const buildPublishArtifact = (
    overrides: Partial<PublishArtifact> = {}
  ): PublishArtifact => ({
    network: "localnet",
    rpcUrl: "http://localhost:9000",
    packagePath: "/tmp/contracts/../move/oracle-market",
    packageId: "0x1",
    sender: "0x2",
    digest: "digest",
    publishedAt: "2024-01-01T00:00:00Z",
    modules: [],
    dependencies: [],
    ...overrides
  })

  it("builds environment flags for move commands", () => {
    expect(buildMoveEnvironmentFlags({})).toEqual([])
    expect(buildMoveEnvironmentFlags({ environmentName: "localnet" })).toEqual([
      "-e",
      "test-publish"
    ])
  })

  it("builds move test arguments with environment name", () => {
    const args = buildMoveTestArguments({
      packagePath: "/tmp/pkg",
      environmentName: "testnet"
    })
    expect(args).toEqual(["--path", "/tmp/pkg", "-e", "testnet"])
  })

  it("builds test publish arguments with flags", () => {
    const args = buildMoveTestPublishArguments({
      packagePath: "/tmp/pkg",
      buildEnvironmentName: "localnet",
      publicationFilePath: "/tmp/publish.json",
      withUnpublishedDependencies: true
    })
    expect(args).toEqual([
      "/tmp/pkg",
      "--build-env",
      "test-publish",
      "--pubfile-path",
      "/tmp/publish.json",
      "--with-unpublished-dependencies"
    ])
  })

  it("normalizes package paths for comparisons", () => {
    const normalized = canonicalizePackagePath("./foo/../bar")
    expect(normalized.endsWith(path.join("bar"))).toBe(true)
  })

  it("resolves package paths relative to move root", () => {
    const moveRoot = "/tmp/move"
    const resolved = resolveFullPackagePath(moveRoot, "packages/oracle")
    expect(resolved).toBe(path.join(moveRoot, "packages", "oracle"))
  })

  it("matches deployments by canonicalized path", () => {
    const artifacts = [
      buildPublishArtifact({
        packagePath: "/tmp/contracts/../move/oracle-market"
      })
    ]
    expect(hasDeploymentForPackage(artifacts, "/tmp/move/oracle-market")).toBe(
      true
    )
  })
})

describe("syncMoveEnvironmentChainId", () => {
  it("inserts environments block when needed", async () => {
    const moveToml = MOVE_TOML

    await withTempDir(async (dir) => {
      await writeFileTree(dir, { "Move.toml": moveToml })

      const result = await syncMoveEnvironmentChainId({
        moveRootPath: dir,
        environmentName: "test-publish",
        chainId: "0xabc"
      })

      expect(result.updatedFiles).toEqual([path.join(dir, "Move.toml")])

      const updated = await readTextFile(path.join(dir, "Move.toml"))
      expect(updated).toContain("[environments]")
      expect(updated).toContain('test-publish = "0xabc"')
    })
  })

  it("skips updates when no environment markers exist", async () => {
    await withTempDir(async (dir) => {
      await writeFileTree(dir, {
        "Move.toml": '[package]\nname = "noop"\nversion = "0.0.1"\n'
      })

      const result = await syncMoveEnvironmentChainId({
        moveRootPath: dir,
        environmentName: "test-publish",
        chainId: "0x123"
      })

      expect(result.updatedFiles).toEqual([])

      const unchanged = await readTextFile(path.join(dir, "Move.toml"))
      expect(unchanged).toBe('[package]\nname = "noop"\nversion = "0.0.1"\n')
    })
  })
})

describe("syncMoveTomlDependencyPublishedIds", () => {
  it("inserts a dep-replacements block when missing", async () => {
    await withTempDir(async (dir) => {
      const moveTomlPath = path.join(dir, "Move.toml")
      await writeFileTree(dir, {
        "Move.toml": '[package]\nname = "noop"\nversion = "0.0.1"\n'
      })

      const result = await syncMoveTomlDependencyPublishedIds({
        moveTomlPath,
        environmentName: "localnet",
        dependencyName: "deepbook",
        publishedAt: "0xabc",
        originalId: "0xabc"
      })

      expect(result.didUpdate).toBe(true)
      const updated = await readTextFile(moveTomlPath)
      expect(updated).toContain("[dep-replacements.localnet]")
      expect(updated).toContain(
        'deepbook = { published-at = "0xabc", original-id = "0xabc" }'
      )
    })
  })

  it("updates an existing dependency replacement", async () => {
    const moveToml = MOVE_TOML

    await withTempDir(async (dir) => {
      const moveTomlPath = path.join(dir, "Move.toml")
      await writeFileTree(dir, { "Move.toml": moveToml })

      const result = await syncMoveTomlDependencyPublishedIds({
        moveTomlPath,
        environmentName: "localnet",
        dependencyName: "Sui",
        publishedAt: "0x42",
        originalId: "0x2"
      })

      expect(result.didUpdate).toBe(true)
      const updated = await readTextFile(moveTomlPath)
      expect(updated).toContain(
        'Sui = { published-at = "0x42", original-id = "0x2" }'
      )
    })
  })

  it("no-ops when the dependency replacement matches", async () => {
    await withTempDir(async (dir) => {
      const moveTomlPath = path.join(dir, "Move.toml")
      await writeFileTree(dir, {
        "Move.toml":
          '[package]\nname = "noop"\nversion = "0.0.1"\n\n[dep-replacements.localnet]\nSui = { published-at = "0x1", original-id = "0x1" }\n'
      })

      const result = await syncMoveTomlDependencyPublishedIds({
        moveTomlPath,
        environmentName: "localnet",
        dependencyName: "Sui",
        publishedAt: "0x1",
        originalId: "0x1"
      })

      expect(result.didUpdate).toBe(false)
      const unchanged = await readTextFile(moveTomlPath)
      expect(unchanged).toContain(
        'Sui = { published-at = "0x1", original-id = "0x1" }'
      )
    })
  })
})

describe("syncMoveTomlDependencyReplacementEntry", () => {
  it("updates dep-replacements with a local path entry", async () => {
    await withTempDir(async (dir) => {
      const moveTomlPath = path.join(dir, "Move.toml")
      await writeFileTree(dir, {
        "Move.toml": '[package]\nname = "noop"\nversion = "0.0.1"\n'
      })

      const result = await syncMoveTomlDependencyReplacementEntry({
        moveTomlPath,
        environmentName: "localnet",
        dependencyName: "deepbook",
        replacementEntry:
          'deepbook = { local = "../deepbook", override = true }'
      })

      expect(result.didUpdate).toBe(true)
      const updated = await readTextFile(moveTomlPath)
      expect(updated).toContain("[dep-replacements.localnet]")
      expect(updated).toContain(
        'deepbook = { local = "../deepbook", override = true }'
      )
    })
  })
})

describe("readMoveTomlDependencyReplacement", () => {
  it("reads published ids from dep-replacements", async () => {
    await withTempDir(async (dir) => {
      await writeFileTree(dir, {
        "Move.toml": [
          "[package]",
          'name = "noop"',
          'version = "0.0.1"',
          "",
          "[dep-replacements.localnet]",
          'deepbook = { published-at = "0xabc", original-id = "0xdef" }'
        ].join("\n")
      })

      const result = await readMoveTomlDependencyReplacement({
        moveTomlPath: path.join(dir, "Move.toml"),
        environmentName: "localnet",
        dependencyName: "deepbook"
      })

      expect(result).toEqual({ publishedAt: "0xabc", originalId: "0xdef" })
    })
  })

  it("reads local path from dep-replacements", async () => {
    await withTempDir(async (dir) => {
      await writeFileTree(dir, {
        "Move.toml": [
          "[package]",
          'name = "noop"',
          'version = "0.0.1"',
          "",
          "[dep-replacements.localnet]",
          'deepbook = { local = "../deepbook", override = true }'
        ].join("\n")
      })

      const result = await readMoveTomlDependencyReplacement({
        moveTomlPath: path.join(dir, "Move.toml"),
        environmentName: "localnet",
        dependencyName: "deepbook"
      })

      expect(result).toEqual({ local: "../deepbook" })
    })
  })

  it("returns undefined when the entry is missing", async () => {
    const moveToml = MOVE_TOML

    await withTempDir(async (dir) => {
      await writeFileTree(dir, { "Move.toml": moveToml })

      const result = await readMoveTomlDependencyReplacement({
        moveTomlPath: path.join(dir, "Move.toml"),
        environmentName: "localnet",
        dependencyName: "deepbook"
      })

      expect(result).toBeUndefined()
    })
  })
})

describe("clearPublishedEntryForNetwork", () => {
  it("removes the published section for a network", async () => {
    const published = PUBLISHED_TOML

    await withTempDir(async (dir) => {
      const publishedPath = path.join(dir, "Published.toml")
      await writeFileTree(dir, { "Published.toml": published })

      const result = await clearPublishedEntryForNetwork({
        packagePath: dir,
        networkName: "localnet"
      })

      expect(result.publishedTomlPath).toBe(publishedPath)
      expect(result.didUpdate).toBe(true)

      const updated = await readTextFile(publishedPath)
      expect(updated).not.toContain("[published.localnet]")
      expect(updated).toContain("[published.testnet]")
    })
  })

  it("no-ops when network name is undefined", async () => {
    const published = PUBLISHED_TOML

    await withTempDir(async (dir) => {
      const publishedPath = path.join(dir, "Published.toml")
      await writeFileTree(dir, { "Published.toml": published })

      const result = await clearPublishedEntryForNetwork({
        packagePath: dir,
        networkName: undefined
      })

      expect(result.publishedTomlPath).toBe(publishedPath)
      expect(result.didUpdate).toBe(false)

      const unchanged = await readTextFile(publishedPath)
      expect(unchanged).toBe(published)
    })
  })
})
