import { describe, it } from "vitest"

// TODO: re-enable once the test harness can provision a real DeepBook `Pool<Base, Quote>`
// plus the matching `Currency<Base>` and `Currency<Quote>` shared objects; `market::new` now
// requires them (see packages/dapp/contracts/prop-amm/sources/market.move) so a zero-pool
// placeholder is no longer valid and this integration test needs to seed the market first.
describe.skip("owner amm-update integration", () => {
  it("updates a shared AMM market maker config and returns the latest snapshot", () => {})
})
