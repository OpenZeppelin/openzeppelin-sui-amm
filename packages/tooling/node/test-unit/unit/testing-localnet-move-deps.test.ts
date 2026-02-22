import { cp } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  readTextFile,
  withTempDir,
  writeFileTree
} from "../../../tests-integration/helpers/fs.ts"
import { prepareMoveSourcesForLocalnetTests } from "../../src/testing/localnet.ts"

describe("localnet move dependency copying", () => {
  it("copies external dependencies into temp move root and rewrites local paths", async () => {
    await withTempDir(async (workspaceRoot) => {
      await writeFileTree(workspaceRoot, {
        "packages/dapp/move/prop-amm/Move.toml": [
          "[package]",
          'name = "PropAmm"',
          'edition = "2024"',
          'version = "0.0.1"',
          "",
          "[dependencies]",
          'deepbook = { local = "../../../../vendor/deepbookv3/packages/deepbook" }'
        ].join("\n"),
        "vendor/deepbookv3/packages/deepbook/Move.toml": [
          "[package]",
          'name = "deepbook"',
          'edition = "2024"',
          'version = "0.0.1"',
          "",
          "[dependencies]",
          'token = { local = "../token" }',
          "",
          "[dep-replacements.localnet]",
          'token = { published-at = "0x123", original-id = "0x123" }'
        ].join("\n"),
        "vendor/deepbookv3/packages/deepbook/Published.toml": [
          "[published.localnet]",
          'chain-id = "00000000"',
          'published-at = "0x123"',
          'original-id = "0x123"',
          "version = 1"
        ].join("\n"),
        "vendor/deepbookv3/packages/token/Move.toml": [
          "[package]",
          'name = "token"',
          'edition = "2024"',
          'version = "0.0.1"'
        ].join("\n")
      })

      const sourceMoveRoot = path.join(
        workspaceRoot,
        "packages",
        "dapp",
        "move"
      )
      const destinationMoveRoot = path.join(workspaceRoot, "tmp-move")
      await cp(sourceMoveRoot, destinationMoveRoot, { recursive: true })

      await prepareMoveSourcesForLocalnetTests({
        destinationMoveRoot,
        sourceMoveRoot,
        workspaceRoot
      })

      const externalDeepbookPath = path.join(
        destinationMoveRoot,
        "__external__",
        "vendor",
        "deepbookv3",
        "packages",
        "deepbook"
      )
      const externalTokenPath = path.join(
        destinationMoveRoot,
        "__external__",
        "vendor",
        "deepbookv3",
        "packages",
        "token"
      )
      const destAmmMoveToml = await readTextFile(
        path.join(destinationMoveRoot, "prop-amm", "Move.toml")
      )
      const destDeepbookMoveToml = await readTextFile(
        path.join(externalDeepbookPath, "Move.toml")
      )
      const destDeepbookPublished = await readTextFile(
        path.join(externalDeepbookPath, "Published.toml")
      )

      expect(destAmmMoveToml).toContain(
        'deepbook = { local = "../__external__/vendor/deepbookv3/packages/deepbook" }'
      )
      expect(destDeepbookMoveToml).toContain('token = { local = "../token" }')
      expect(destDeepbookMoveToml).not.toContain("dep-replacements.localnet")
      expect(destDeepbookPublished).not.toContain("[published.localnet]")

      const sourceDeepbookMoveToml = await readTextFile(
        path.join(
          workspaceRoot,
          "vendor",
          "deepbookv3",
          "packages",
          "deepbook",
          "Move.toml"
        )
      )
      const sourceDeepbookPublished = await readTextFile(
        path.join(
          workspaceRoot,
          "vendor",
          "deepbookv3",
          "packages",
          "deepbook",
          "Published.toml"
        )
      )

      expect(sourceDeepbookMoveToml).toContain("dep-replacements.localnet")
      expect(sourceDeepbookPublished).toContain("[published.localnet]")

      await Promise.all([
        readTextFile(path.join(externalTokenPath, "Move.toml"))
      ])
    })
  })
})
