# OpenZeppelin Market Maker for Sui

This package contains the OpenZeppelin Market Maker Move modules for market-making configuration and quote execution on DeepBook.
It is experimental and unaudited.

## What this package provides

- Admin-gated AMM configuration (`manager.move`).
- Trader account creation with embedded DeepBook caps (`executor.move`).
- Deposit/withdraw operations through the trader account.
- Quote refresh logic that reads Pyth prices, computes spreads, and places limit orders.
- Event surface for config lifecycle, trader account creation, and quote updates (`events.move`).

## Modules

- `manager`: creates and updates `AMMConfig` objects; owns `AMMAdminCap` lifecycle.
- `executor`: manages per-trader state and quote refresh workflow.
- `events`: emits typed events consumed by tests and off-chain indexers.

## Core objects

- `AMMAdminCap`: capability required for privileged config and account setup operations.
- `AMMConfig` (shared object):
  - `base_spread_bps`
  - `volatility_spread_bps`
  - `use_laser`
  - `trading_paused`
  - `pyth_price_feed_id` (must be 32 bytes)
- `TraderAccount` (owned object):
  - DeepBook `BalanceManager`
  - embedded caps (`TradeCap`, `DepositCap`, `WithdrawCap`)

## Events

- `AMMConfigCreated`
- `AMMConfigUpdated`
- `TraderAccountCreated`
- `QuoteUpdated`

## Main workflow

1. Publish package (or call `manager::test_init` in tests) to initialize and transfer `AMMAdminCap` to publisher/sender.
2. Create shared config with `manager::create_amm_config_and_share`.
3. Ensure DeepBook registry is authorized for `executor::PropAmmApp` and balance-manager map is initialized.
4. Create a trader account with `executor::create_trader_account` or `executor::create_trader_account_for_owner`.
5. Fund account with `executor::deposit` and optionally withdraw with `executor::withdraw`.
6. Call `executor::refresh_quotes` to:
    - validate trading is enabled,
    - validate Pyth feed ID matches config,
    - read oracle mid price,
    - cancel stale orders and settle filled amounts,
    - place four new limit orders (2 bids + 2 asks) around mid using base/volatility spreads,
    - emit `QuoteUpdated`.

## Testing

From this package directory:

```bash
sui move build --build-env test-publish
sui move test --build-env test-publish
```
