import { describe, expect, it } from "vitest"
import {
  extractSingleSuiFrameworkRevisionFromMoveLock,
  extractSuiFrameworkPinnedEntriesFromMoveLock,
  extractSuiFrameworkRevisionsFromMoveLock
} from "../../src/move-lock.ts"
import {
  MOVE_LOCK_LEGACY,
  MOVE_LOCK_PINNED
} from "../../../test-helpers/fixtures.ts"

describe("extractSuiFrameworkRevisionsFromMoveLock", () => {
  it("extracts revisions from pinned Move.lock", () => {
    const revisions = extractSuiFrameworkRevisionsFromMoveLock({
      lockContents: MOVE_LOCK_PINNED
    })

    expect([...revisions].sort()).toEqual(["1111111", "2222222", "3333333"])
  })

  it("filters pinned revisions by environment", () => {
    const revisions = extractSuiFrameworkRevisionsFromMoveLock({
      lockContents: MOVE_LOCK_PINNED,
      environmentName: "testnet"
    })

    expect([...revisions].sort()).toEqual(["2222222", "3333333"])
  })

  it("extracts revisions from legacy Move.lock", () => {
    const revisions = extractSuiFrameworkRevisionsFromMoveLock({
      lockContents: MOVE_LOCK_LEGACY
    })

    expect([...revisions].sort()).toEqual(["aaaa", "bbbb"])
  })

  it("returns empty set for unknown format", () => {
    const revisions = extractSuiFrameworkRevisionsFromMoveLock({
      lockContents: "not a lock file"
    })

    expect([...revisions]).toEqual([])
  })
})

describe("extractSuiFrameworkPinnedEntriesFromMoveLock", () => {
  it("returns pinned entry metadata for environment", () => {
    const entries = extractSuiFrameworkPinnedEntriesFromMoveLock({
      lockContents: MOVE_LOCK_PINNED,
      environmentName: "testnet"
    })

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentName: "testnet",
          packageName: "Sui_1",
          revision: "2222222"
        }),
        expect.objectContaining({
          environmentName: "testnet",
          packageName: "MoveStdlib_1",
          revision: "3333333"
        })
      ])
    )
  })
})

describe("extractSingleSuiFrameworkRevisionFromMoveLock", () => {
  it("returns one revision from legacy locks", () => {
    const revision = extractSingleSuiFrameworkRevisionFromMoveLock({
      lockContents: MOVE_LOCK_LEGACY
    })

    expect(["aaaa", "bbbb"]).toContain(revision)
  })
})
