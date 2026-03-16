import type * as MoveModule from "@sui-amm/tooling-node/move"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

const moveMocks = vi.hoisted(() => ({
  readMoveTomlDependencyReplacement: vi.fn()
}))

vi.mock("@sui-amm/tooling-node/move", async (importOriginal) => ({
  ...(await importOriginal<typeof MoveModule>()),
  readMoveTomlDependencyReplacement: moveMocks.readMoveTomlDependencyReplacement
}))

import {
  assertLocalnetAmmDependencyReplacementsReady,
  resolveDeepbookPublishedIds
} from "../deepbook.ts"

type AmmDependencyTooling = Parameters<
  typeof assertLocalnetAmmDependencyReplacementsReady
>[0]["tooling"]

const createAmmDependencyTooling = ({
  moveRootPath = "/tmp/move"
}: {
  moveRootPath?: string
} = {}): AmmDependencyTooling =>
  ({
    suiConfig: {
      paths: {
        move: moveRootPath
      }
    }
  }) as unknown as AmmDependencyTooling

describe("resolveDeepbookPublishedIds", () => {
  it("returns known published ids for shared networks", () => {
    expect(resolveDeepbookPublishedIds("testnet")).toEqual({
      publishedAt:
        "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c",
      originalId:
        "0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982"
    })
    expect(resolveDeepbookPublishedIds("mainnet")).toEqual({
      publishedAt:
        "0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497",
      originalId:
        "0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809"
    })
  })

  it("returns undefined when the network is not mapped", () => {
    expect(resolveDeepbookPublishedIds("localnet")).toBeUndefined()
  })
})

describe("assertLocalnetAmmDependencyReplacementsReady", () => {
  it("skips packages outside the AMM path", async () => {
    moveMocks.readMoveTomlDependencyReplacement.mockReset()

    await expect(
      assertLocalnetAmmDependencyReplacementsReady({
        tooling: createAmmDependencyTooling(),
        packagePath: "/tmp/move/other-package"
      })
    ).resolves.toBeUndefined()

    expect(moveMocks.readMoveTomlDependencyReplacement).not.toHaveBeenCalled()
  })

  it("accepts prepared localnet DeepBook replacements", async () => {
    moveMocks.readMoveTomlDependencyReplacement.mockReset()
    moveMocks.readMoveTomlDependencyReplacement
      .mockResolvedValueOnce({
        local: "../vendor/deepbookv3/packages/deepbook"
      })
      .mockResolvedValueOnce({
        local: "../vendor/deepbookv3/packages/deepbook"
      })
      .mockResolvedValueOnce({
        publishedAt: "0x1",
        originalId: "0x2"
      })

    const packagePath = "/tmp/move/prop-amm"
    const ammMoveTomlPath = path.join(packagePath, "Move.toml")
    const expectedDeepbookMoveTomlPath = path.resolve(
      path.dirname(ammMoveTomlPath),
      "../vendor/deepbookv3/packages/deepbook",
      "Move.toml"
    )

    await expect(
      assertLocalnetAmmDependencyReplacementsReady({
        tooling: createAmmDependencyTooling(),
        packagePath
      })
    ).resolves.toBeUndefined()

    expect(moveMocks.readMoveTomlDependencyReplacement).toHaveBeenNthCalledWith(
      1,
      {
        moveTomlPath: ammMoveTomlPath,
        environmentName: "test-publish",
        dependencyName: "deepbook"
      }
    )
    expect(moveMocks.readMoveTomlDependencyReplacement).toHaveBeenNthCalledWith(
      2,
      {
        moveTomlPath: ammMoveTomlPath,
        environmentName: "test-publish",
        dependencyName: "deepbook"
      }
    )
    expect(moveMocks.readMoveTomlDependencyReplacement).toHaveBeenNthCalledWith(
      3,
      {
        moveTomlPath: expectedDeepbookMoveTomlPath,
        environmentName: "test-publish",
        dependencyName: "token"
      }
    )
  })

  it("fails clearly when the AMM DeepBook replacement is missing", async () => {
    moveMocks.readMoveTomlDependencyReplacement.mockReset()
    moveMocks.readMoveTomlDependencyReplacement.mockResolvedValueOnce(undefined)

    await expect(
      assertLocalnetAmmDependencyReplacementsReady({
        tooling: createAmmDependencyTooling(),
        packagePath: "/tmp/move/prop-amm"
      })
    ).rejects.toThrow(/Missing deepbook dep-replacements\.test-publish entry/)
  })

  it("fails clearly when the AMM Move.toml cannot be read", async () => {
    moveMocks.readMoveTomlDependencyReplacement.mockReset()
    moveMocks.readMoveTomlDependencyReplacement.mockRejectedValueOnce(
      new Error("missing Move.toml")
    )

    await expect(
      assertLocalnetAmmDependencyReplacementsReady({
        tooling: createAmmDependencyTooling(),
        packagePath: "/tmp/move/prop-amm"
      })
    ).rejects.toThrow(
      "Unable to read /tmp/move/prop-amm/Move.toml. Ensure the path exists before publishing."
    )
  })
})
