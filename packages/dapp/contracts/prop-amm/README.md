# OpenZeppelin Market Maker for Sui

This package contains the OpenZeppelin Market Maker Move modules for market-making configuration and quote execution on DeepBook.
It is experimental and unaudited.

## What this package provides

- Market metadata construction for a DeepBook pool and its Pyth feeds (`market.move`).
- Quoting parameter construction (`config.move`).
- Market maker executor creation with embedded DeepBook caps, embedded market, and embedded config (`executor.move`).
- Deposit/withdraw operations through the market maker.
- Quote refresh logic that reads Pyth prices, computes spreads, and places limit orders.
- Event surface for market maker creation and quote updates (`events.move`).

## Modules

- `market`: validates and builds `Market` values (pool ID, base/quote Pyth feed IDs, cached publish timestamps).
- `config`: validates and builds `AMMConfig` values (spreads, order expiration, oracle freshness and confidence limits).
- `executor`: owns the market maker object, its capability, balances, and quote refresh workflow.
- `events`: emits typed events consumed by tests and off-chain indexers.

## Core objects

- `Market` (embedded value):
  - `pool_id`
  - `base_pyth_price_feed_id` (must be 32 bytes)
  - `quote_pyth_price_feed_id` (must be 32 bytes)
  - `base_price_publish_time`, `quote_price_publish_time` (cached Pyth timestamps)
- `AMMConfig` (embedded value):
  - `active`
  - `base_spread_bps`
  - `volatility_spread_bps`
  - `order_expiration_time_ms`
  - `max_price_age_secs`
  - `max_conf_ratio_bps`
- `MarketMaker` (owned object):
  - DeepBook `BalanceManager`
  - embedded `Market`
  - embedded `AMMConfig`
  - embedded caps (`TradeCap`, `DepositCap`, `WithdrawCap`)
- `AdminCap` (owned object): capability required to update market/config and manage balances for a specific market maker.

## Events

- `MarketMakerCreated`
- `QuoteUpdated`
- `MarketMakerPaused`
- `MarketMakerUnpaused`
- `MarketMakerConfigUpdated`
- `MarketUpdated`

## Main workflow

1. Publish package (or call `executor::test_init` in tests) to initialize package metadata.
2. Build a `Market` with `market::new` and an `AMMConfig` with `config::new`.
3. Ensure the DeepBook registry balance-manager map is initialized.
4. Create a market maker and admin cap with `executor::create`, passing the `Market` and `AMMConfig`.
5. Fund account balances with `executor::deposit` and optionally withdraw with `executor::withdraw`.
6. To update quoting parameters, create a new `AMMConfig` with `config::new` and pass it to `executor::update_config`.
7. To replace the traded pool or Pyth feeds, pause the market maker, then pass a new `Market` to `executor::update_market`.
8. Call `executor::refresh_quotes` to:
    - validate trading is enabled,
    - validate base and quote Pyth feed IDs match the configured market,
    - read base/USD and quote/USD prices and derive base/quote mid price,
    - skip refresh only when both feed publish times are stale/replayed,
    - cancel stale orders and settle filled amounts,
    - place four new limit orders (2 bids + 2 asks) around mid using base/volatility spreads,
    - emit `QuoteUpdated`.

## Testing

From this package directory:

```bash
sui move build --build-env test-publish
sui move test --build-env test-publish
```
