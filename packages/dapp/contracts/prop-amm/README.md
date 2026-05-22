# OpenZeppelin Market Maker for Sui

This package contains the OpenZeppelin Market Maker Move modules for market-making configuration and quote execution on DeepBook.

## What this package provides

- Market metadata construction for a DeepBook pool and its Pyth feeds (`market.move`).
- Quoting parameter construction (`config.move`).
- Market maker executor creation with embedded DeepBook caps, embedded market, and embedded config (`executor.move`).
- Deposit/withdraw operations through the market maker executor.
- Two quote refresh entrypoints: `refresh_quotes_permissionless` (bot-driven, reads Pyth) and `refresh_quotes` (admin-driven, accepts an off-chain mid price). Both compute spreads and place limit orders.
- Event surface for market maker executor creation and quote updates (`events.move`).

## Pool requirements

Only **whitelisted** DeepBook pools (`pool.whitelisted() == true`) are supported. The quote-refresh ladder allocates 100% of each side's settled balance across two limit orders with no fee headroom, and orders are placed with `pay_with_deep = false`. On non-whitelisted pools DeepBook charges the maker fee in the input asset, so the second order on each side aborts the refresh with `EBalanceManagerBalanceTooLow`. `market::new` rejects non-whitelisted pools at construction time with `EPoolNotWhitelisted`.

## Modules

- `market`: validates and builds `Market` values (pool ID, per-side coin type / decimals / Pyth feed ID / cached publish timestamp).
- `config`: validates and builds `AMMConfig` values (spreads, order expiration, oracle freshness and confidence limits, inventory skew).
- `executor`: owns the market maker executor object, its capability, balances, and quote refresh workflow.
- `info`: per-executor accounting snapshot (cumulative volume plus per-side balance / cumulative deposited / cumulative withdrawn).
- `events`: emits typed events consumed by tests and off-chain indexers.

## Core objects

- `Market` (embedded value):
  - `pool_id` — the DeepBook pool this executor is bound to.
  - `base: MarketCurrency`, `quote: MarketCurrency` — per-side metadata, each containing:
    - `coin_type` — fully-qualified Move type used to route deposits/withdrawals.
    - `decimals` — cached asset decimals (read at construction time from the asset's `Currency` object).
    - `pyth_price_feed_id` — 32-byte Pyth feed identifier for this side.
    - `price_publish_time` — `Option<u64>` of the latest observed Pyth publish timestamp; used to detect replayed reads.
- `AMMConfig` (embedded value):
  - `base_spread_bps` — inner-order spread around the mid, in basis points (0..10_000).
  - `volatility_multiplier_bps` — multiplier (in bps) applied to the combined Pyth confidence ratio to derive the outer (volatility) order's extra spread.
  - `outer_balance_bps` — share of each side's balance allocated to the outer order, in basis points (0..10_000); the inner order receives the remainder.
  - `inventory_skew_bps` — fraction of `base_spread` (in bps, 0..10_000) by which to shift the reservation mid toward the rebalancing side at fully one-sided inventory.
  - `max_conf_ratio_bps` — maximum acceptable Pyth confidence-to-price ratio, in basis points; reads above this abort.
  - `max_price_age_secs` — maximum acceptable Pyth price age, in seconds.
  - `order_expiration_time_ms` — limit-order expiration duration, in milliseconds.
- `Executor` (owned object, the market maker executor):
  - `active` flag — `false` on creation; flip to `true` via `unpause` to allow quote refreshes.
  - DeepBook `BalanceManager`
  - embedded `Market`
  - embedded `AMMConfig`
  - embedded `Info` accounting snapshot (cumulative volume, per-side balance / deposited / withdrawn).
  - embedded caps (`TradeCap`, `DepositCap`, `WithdrawCap`)
- `Info` (embedded value): accounting snapshot updated on every quote refresh, deposit, and withdrawal.
  - `volume_base` — cumulative base-asset volume traded within the current epoch.
  - `base: CurrencyInfo`, `quote: CurrencyInfo` — per-side `{ balance, deposited, withdrawn }`. `balance` is the cached post-settlement balance; `deposited` / `withdrawn` are cumulative `u128` totals (saturating).
- `AdminCap` (owned object): capability required to update config, pause/unpause, manage balances (`deposit` / `withdraw` / `withdraw_all`), and call the admin-driven `refresh_quotes` for a specific market maker executor.

## Events

- `ExecutorCreated`
- `QuoteUpdated`
- `ExecutorPaused`
- `ExecutorUnpaused`
- `ExecutorConfigUpdated`
- `Deposited`
- `Withdrawn`

## Main workflow

1. Publish package (or call `executor::test_init` in tests) to initialize package metadata.
2. Build a `Market` with `market::new` and an `AMMConfig` with `config::new`.
3. Ensure the DeepBook registry balance-manager map is initialized.
4. Create a market maker executor and admin cap with `executor::create`, passing the `Market` and `AMMConfig`. The executor is paused on creation; call `executor::unpause` to enable trading.
5. Fund account balances with `executor::deposit`. To withdraw, first call `executor::pause` (so DeepBook settles open orders into the BalanceManager), then either `executor::withdraw` for a partial amount or `executor::withdraw_all` to drain the side's full balance.
6. To update quoting parameters, create a new `AMMConfig` with `config::new` and pass it to `executor::update_config`.
7. Refresh quotes through one of the two entrypoints:
    - **Permissionless (bot-driven, Pyth-based)** — `executor::refresh_quotes_permissionless`. Anyone can call it. It:
        - validates trading is enabled,
        - validates base and quote Pyth feed IDs match the configured market,
        - reads base/USD and quote/USD Pyth prices and derives the base/quote mid price,
        - skips the refresh only when both feed publish times are stale/replayed,
        - cancels stale orders and settles filled amounts,
        - places four new limit orders (2 bids + 2 asks) around the mid using base/volatility spreads,
        - emits `QuoteUpdated`.
    - **Admin (off-chain feed)** — `executor::refresh_quotes`, gated by the matching `AdminCap`. The caller supplies the `mid_price` and combined confidence ratio (`conf_ratio_bps`, in basis points) directly, bypassing the Pyth oracle. Use this when quoting off off-chain market data (e.g. a CEX feed) is preferable. The cancel/settle, four-order ladder, and `QuoteUpdated` emission are identical to the permissionless path; the Pyth feed-id and publish-time checks do not apply.

## Testing

From this package directory:

```bash
sui move build --build-env test-publish
sui move test --build-env test-publish
```
