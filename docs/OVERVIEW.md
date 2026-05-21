# dApp overview

A page-by-page tour of what the UI lets you do once you've completed the
[Quickstart](../README.md#quickstart-localnet) and connected a wallet. Each
page reads its data live from chain (no backend) and submits PTBs through
the connected wallet.

For the design decisions behind the on-chain contracts, see
[ARCHITECTURE.md](ARCHITECTURE.md).

## /setup — Create an AMM Executor

The landing page when no executor is yet bound to your wallet. Pick the
default DeepBook pool to make markets on, paste the Pyth feed-id hexes
for each side, set the AMM parameters, and submit a single PTB that
publishes the `Market`, the `AMMConfig`, the shared `Executor`, and
transfers the `AdminCap` to your address.

![/setup page — Create AMM executor form: pool id, base/quote Pyth feed ids, base_spread / volatility_multiplier / outer_balance / inventory_skew bps, max age + max conf bounds](images/amm_setup.png)

What you do here:

- **Base / quote coin types** auto-fill from `mock.localnet.json` on
  localnet (SUI / USDC) and can be overridden manually for other pools.
- **Pyth feed-id hex** for SUI/USD and USDC/USD comes from
  https://docs.pyth.network/price-feeds/core/price-feeds/price-feed-ids
  — the same hex works on localnet because the pyth-mock seeds the same
  identifiers.
- **AMM parameters** all use bps for spreads / shares and seconds (or ms)
  for time bounds. Defaults are sensible for SUI/USDC; tweak them on
  `/config` after the executor is live without re-creating it.

## /dashboard — Live state

Once the executor exists, this is where you'll spend most of your time.
Mid price (oracle line + DeepBook line + the inner/outer spread bands the
AMM is currently posting), inventory split, the four orders attached to the
latest `QuoteUpdated`, and the on-chain event log all auto-update from
chain polling.

![/dashboard — Mid Price card with oracle/DeepBook/inner/outer overlay, Balances split, Active Orders table, Event Feed](images/dashboard.png)

What you do here:

- Click any legend pill (DeepBook, Inner spread, Outer spread) to toggle
  that series on/off and re-zoom the y-axis.
- Inspect the four open orders the AMM is currently quoting — two bids,
  two asks, with prices that match the inner+outer ring math
  (`m ± inner_spread`, `m ± outer_spread`).
- Watch `QuoteUpdated`, `Deposited`, `Withdrawn` events stream in as the
  bots / wallet activity fires them.

## /funding — Deposit and withdraw

Move base or quote coins between the connected wallet and the executor's
embedded `BalanceManager`. The AMM only quotes against funds it actually
holds, so this is the gate between "executor exists" and "AMM makes a
market".

![/funding — Deposit and Withdraw cards with side selector (base/quote), amount field, Withdraw-all toggle](images/funding.png)

What you do here:

- **Deposit** picks the richest coin object of the chosen type from your
  wallet and sends an `executor::deposit<T>` PTB.
- **Withdraw** runs `executor::withdraw<T>` / `executor::withdraw_all<T>`,
  wrapped between `pause` and `unpause` automatically when the executor
  is currently active so the BalanceManager unlocks for the duration of
  the call without leaving you in a paused state.

## /config — Update AMM config

Live re-tune of the AMM parameters without recreating the executor.
Everything you set on `/setup` is editable here; the form is grouped into
four sections so spread/volatility, inventory, order-lifecycle, and
safety params don't crowd each other. BPS fields render as percent
inputs with sliders; numeric fields take raw integers.

![/config — Update config form grouped into Spread / Volatility, Inventory, Order Lifecycle, Safety. BPS fields show as percent inputs with sliders.](images/config.png)

### Spread / Volatility

- **Base spread** (`base_spread_bps`) — inner-order distance from the
  oracle mid, as a fraction of the mid (must be `< 100 %`).
- **Volatility multiplier** (`volatility_multiplier_bps`) — extra buffer
  added on top of the base spread for the outer order, scaled by the
  Pyth confidence ratio. No upper cap.
- **Max confidence ratio** (`max_conf_ratio_bps`) — refuses to quote
  when the Pyth confidence-to-price ratio exceeds this fraction.

### Inventory

- **Outer balance** (`outer_balance_bps`) — share of the
  `BalanceManager` balance allocated to the outer (volatility) order;
  the rest goes to the inner order.
- **Inventory skew** (`inventory_skew_bps`) — mid-shift coefficient
  applied when the base/quote inventory split is imbalanced. `0`
  disables the skew.

### Order Lifecycle

- **Order expiration (ms)** (`order_expiration_time_ms`) — DeepBook
  order time-to-live.
- **Max Pyth price age (s)** (`max_price_age_secs`) — rejects oracle
  reads older than this many seconds.

These two fields are **cross-validated** to mirror the Move-side
`EOrderExpirationExceedsPriceAge` check in `config::new`: order TTL
must be `≤ max_price_age × 1000`, otherwise an order could remain live
on the book priced against a stale oracle read. The form blocks submit
and surfaces the violation on both inputs until the relation holds.

### Safety

- **Stale price tolerance** (`stale_price_tolerance_bps`) — interpreted
  as a fraction of the base spread, this is how far the ladder is
  allowed to drift before a permissionless refresh actually re-quotes.
  `0` disables the guard and every Pyth tick forces a refresh; higher
  values preserve DeepBook FIFO priority by skipping refreshes that
  would barely move the ladder.
- **Post-only quotes** (`post_only`) — when on, any order that would
  cross the resting book aborts the entire refresh and the previous
  ladder stays live. When off, the crossing portion executes as a taker
  against external liquidity.

### Buttons

- **Reset defaults** — replays the values from
  `buildAmmConfigFormState()` through the same per-field setters the
  form uses, so dirty-tracking and validation re-run as if you typed
  them. Does not write on chain.
- **Update config** — submits `executor::update_config<Base, Quote>`
  followed by `cancel_orders_after_update` in the same PTB. The hot-
  potato `RefreshTicket` returned by `update_config` forces the live
  ladder to be cancelled before the transaction settles, so no order
  can remain on the book quoting under the replaced configuration.
- **Update & refresh quotes** (localnet only) — same `update_config`
  call, but instead of cancelling the ladder the PTB re-stamps the mock
  Pyth `PriceInfoObject`s with their current magnitudes and an advanced
  timestamp, then re-quotes through `refresh_quotes_pyth_after_update`.
  Lets you see the new spread/skew settings reflected in fresh orders
  without waiting for the maintenance bot or a real Pyth tick. Disabled
  on non-localnet networks and when the executor is paused.

## /bot — Bot Status & manual refresh

Pause/unpause the executor and trigger an off-cycle quote refresh from the
UI (the same code path the maintenance bot uses on a timer). Useful when
you want to see a single fresh quote without spinning up the bot.

![/bot — Bot Status card showing active flag, last refresh, Refresh quotes + Pause/Unpause buttons](images/amm_status.png)

What you do here:

- **Refresh quotes** runs `executor::refresh_quotes_permissionless<Base,
Quote>` immediately. Pyth `PriceInfoObject` timestamps get re-stamped in
  the same PTB so the executor's `assert_price_age_within_limit` doesn't
  abort.
- **Refresh Quotes (admin)** runs the AdminCap-gated
  `executor::refresh_quotes<Base, Quote>` with a caller-supplied mid price
  and confidence ratio, bypassing Pyth entirely. Useful when you want to
  quote off off-chain market data (e.g. a CEX feed) or test ladder shape
  against a known price without waiting for the oracle. The form takes the
  mid in human dollars (e.g. `1.50`, in `quote per base`) and the
  confidence ratio in percent (e.g. `1.5`, mapped to `150` bps), then the
  hook converts to DeepBook fixed-point u64 (`humanPrice × 10^(9 −
  baseDecimals + quoteDecimals)`) on submit. Works on every network — no
  Pyth or Hermes dependency. Requires the connected wallet to hold the
  executor's `AdminCap` and the executor to be active.
- **Pause / Unpause** toggles trading. While paused the existing orders
  stay live on the book but no new refreshes can run; **Withdraw all** on
  `/funding` is the typical reason to pause.

## /performance — Cumulative metrics

Reads `Info` (the executor's lifetime accounting struct) plus events to
chart cumulative volume, deposited vs withdrawn flow per side, and
realised PnL approximations.

![/performance — Volume + flow chart, lifetime base/quote deposited/withdrawn counters, PnL summary](images/performance.png)

What you do here:

- Watch how aggressively the AMM is being filled — high `volume_base`
  with flat inventory means the rings are catching flow on both sides.
- Compare deposited vs withdrawn to spot one-sided drift.

## Where to go next

- [ARCHITECTURE.md](ARCHITECTURE.md) — the AMM's design rationale and PTB
  flow diagram.
- [Top-level README](../README.md) — install / Quickstart / market-activity
  bot recipe.
