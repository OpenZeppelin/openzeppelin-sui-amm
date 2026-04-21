# OpenZeppelin Market Maker for Sui

This package contains the OpenZeppelin Market Maker Move modules for market-making configuration and quote execution on DeepBook.
It is experimental and unaudited.

## What this package provides

- Config construction for pool-specific quoting (`config.move`).
- Market maker executor creation with embedded DeepBook caps and embedded config (`executor.move`).
- Deposit/withdraw operations through the market maker.
- Quote refresh logic that reads Pyth prices, computes spreads, and places limit orders.
- Event surface for market maker creation and quote updates (`events.move`).

## Modules

- `config`: validates and builds `AMMConfig` values for a DeepBook pool.
- `executor`: owns the market maker object, its capability, balances, and quote refresh workflow.
- `events`: emits typed events consumed by tests and off-chain indexers.

## Core objects

- `AMMConfig` (embedded value):
  - `base_spread_bps`
  - `volatility_spread_bps`
  - `trading_paused`
  - `base_pyth_price_feed_id` (must be 32 bytes)
  - `quote_pyth_price_feed_id` (must be 32 bytes)
- `MarketMaker` (owned object):
  - DeepBook `BalanceManager`
  - embedded `AMMConfig`
  - embedded caps (`TradeCap`, `DepositCap`, `WithdrawCap`)
- `AdminCap` (owned object): capability required to update config and manage balances for a specific market maker.

## Events

- `MarketMakerCreated`
- `QuoteUpdated`

## Main workflow

1. Publish package (or call `executor::test_init` in tests) to initialize package metadata.
2. Build a pool-specific config with `config::create`.
3. Ensure the DeepBook registry balance-manager map is initialized.
4. Create a market maker and admin cap with `executor::create`.
5. Fund account balances with `executor::deposit` and optionally withdraw with `executor::withdraw`.
6. To update quoting parameters, create a new config with `config::create` and pass it to `executor::update_market_maker`.
7. Call `executor::refresh_quotes` to:
    - validate trading is enabled,
    - validate base and quote Pyth feed IDs match config,
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
