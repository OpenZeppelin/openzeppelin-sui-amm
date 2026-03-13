import { describe, expect, it } from "vitest"

import {
  DEFAULT_COIN_CONTRACT_PATH,
  DEFAULT_DEEPBOOK_PATH,
  DEFAULT_DEEPBOOK_TOKEN_PATH,
  DEFAULT_PYTH_CONTRACT_PATH
} from "../mocks.ts"

const toPortablePath = (value: string) => value.replace(/\\/g, "/")

describe("mock path defaults", () => {
  it("resolves dapp mock contract defaults under contracts", () => {
    expect(toPortablePath(DEFAULT_COIN_CONTRACT_PATH)).toMatch(
      /\/packages\/dapp\/contracts\/coin-mock$/
    )
    expect(toPortablePath(DEFAULT_PYTH_CONTRACT_PATH)).toMatch(
      /\/packages\/dapp\/contracts\/pyth-mock$/
    )
  })

  it("resolves deepbook defaults under vendor", () => {
    expect(toPortablePath(DEFAULT_DEEPBOOK_PATH)).toMatch(
      /\/vendor\/deepbookv3\/packages\/deepbook$/
    )
    expect(toPortablePath(DEFAULT_DEEPBOOK_TOKEN_PATH)).toMatch(
      /\/vendor\/deepbookv3\/packages\/token$/
    )
  })
})
