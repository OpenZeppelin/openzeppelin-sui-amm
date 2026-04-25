# OpenZeppelin Market Maker for Sui

This package contains the OpenZeppelin Market Maker Move modules for market-making configuration and quote execution on DeepBook.
It is experimental and unaudited.

## What this package provides

- Market metadata construction for a DeepBook pool and its Pyth feeds (`market.move`).
- Quoting parameter construction (`config.move`).
- Market maker executor creation with embedded DeepBook caps, embedded market, and embedded config (`executor.move`).
- Deposit/withdraw operations through the market maker executor.
- Two quote refresh entrypoints: `refresh_quotes_permissionless` (bot-driven, reads Pyth) and `refresh_quotes` (admin-driven, accepts an off-chain mid price). Both compute spreads and place limit orders.
- Event surface for market maker executor creation and quote updates (`events.move`).

## Modules

- `market`: validates and builds `Market` values (pool ID, base/quote Pyth feed IDs, cached publish timestamps).
- `config`: validates and builds `AMMConfig` values (spreads, order expiration, oracle freshness and confidence limits).
- `executor`: owns the market maker executor object, its capability, balances, and quote refresh workflow.
- `events`: emits typed events consumed by tests and off-chain indexers.

## Core objects

- `Market` (embedded value):
  - `pool_id`
  - `base_pyth_price_feed_id` (must be 32 bytes)
  - `quote_pyth_price_feed_id` (must be 32 bytes)
  - `base_price_publish_time`, `quote_price_publish_time` (cached Pyth timestamps)
- `AMMConfig` (embedded value):
  - `base_spread_bps`
  - `volatility_spread_bps`
  - `order_expiration_time_ms`
  - `max_price_age_secs`
  - `max_conf_ratio_bps`
- `Executor` (owned object, the market maker executor):
  - `active` flag
  - DeepBook `BalanceManager`
  - embedded `Market`
  - embedded `AMMConfig`
  - embedded caps (`TradeCap`, `DepositCap`, `WithdrawCap`)
- `AdminCap` (owned object): capability required to update config, pause/unpause, and manage balances for a specific market maker executor.

## Events

- `ExecutorCreated`
- `QuoteUpdated`
- `ExecutorPaused`
- `ExecutorUnpaused`
- `ExecutorConfigUpdated`

## Main workflow

1. Publish package (or call `executor::test_init` in tests) to initialize package metadata.
2. Build a `Market` with `market::new` and an `AMMConfig` with `config::new`.
3. Ensure the DeepBook registry balance-manager map is initialized.
4. Create a market maker executor and admin cap with `executor::create`, passing the `Market` and `AMMConfig`.
5. Fund account balances with `executor::deposit` and optionally withdraw with `executor::withdraw`.
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
