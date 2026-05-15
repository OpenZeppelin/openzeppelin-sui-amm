/// Market making execution logic.
module openzeppelin_market_maker::executor;

use deepbook::balance_manager::{
    Self,
    BalanceManager,
    DepositCap,
    TradeCap,
    WithdrawCap,
    TradeProof
};
use deepbook::constants;
use deepbook::pool::Pool;
use openzeppelin_market_maker::config::AMMConfig;
use openzeppelin_market_maker::events;
use openzeppelin_market_maker::info::{Self, Info};
use openzeppelin_market_maker::market::Market;
use pyth::price_info::PriceInfoObject;
use pyth::pyth;
use std::type_name;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::package;

// === Errors ===

#[error(code = 0)]
const EPythFeedIdentifierMismatch: vector<u8> = "pyth feed identifier mismatch";
#[error(code = 1)]
const EInvalidPool: vector<u8> = "pool does not match the associated pool";
#[error(code = 2)]
const EInvalidCap: vector<u8> = "invalid market maker cap";
#[error(code = 3)]
const EPaused: vector<u8> = "trading paused";
#[error(code = 4)]
const ENotPaused: vector<u8> = "trading not paused";
#[error(code = 5)]
const EInvalidQuantity: vector<u8> = "can't place order due to invalid quantity";
#[error(code = 6)]
const EConfigUnchanged: vector<u8> = "new config is identical to the current config";
#[error(code = 7)]
const EPriceUnderflow: vector<u8> = "price lower than minimum or underflowed";
#[error(code = 8)]
const EPriceOverflow: vector<u8> = "price higher than maximum or overflowed";
#[error(code = 9)]
const EUnsupportedAsset: vector<u8> = "coin type does not match the configured base or quote asset";

// === Structs ===

/// Capability required to update configuration.
public struct AdminCap has key, store {
    /// Unique ID for the market maker executor capability object.
    id: UID,
    /// ID of the associated executor.
    executor_id: ID,
}

/// Market maker executor state.
public struct Executor has key, store {
    /// Unique ID for the executor object.
    id: UID,
    /// Whether trading is active.
    active: bool,
    /// Deepbook capabilities retained by the owner.
    caps: Caps,
    /// Balance manager linked to the market maker.
    balance_manager: BalanceManager,
    /// Traded market metadata (pool, feed IDs).
    market: Market,
    /// AMM configuration.
    config: AMMConfig,
    /// Accounting info (cumulative volume and cached balances).
    info: Info,
}

/// Balance manager caps owned by the market maker executor owner.
public struct Caps has store {
    /// Deepbook's trade capability.
    trade_cap: TradeCap,
    /// Deepbook's deposit capability.
    deposit_cap: DepositCap,
    /// Deepbook's withdraw capability.
    withdraw_cap: WithdrawCap,
}

/// Input for a single limit order.
public struct LimitOrderParams has copy, drop {
    /// Price in DeepBook fixed-point format.
    price: u64,
    /// Quantity in base asset terms (lot-size aligned).
    quantity: u64,
    /// `true` for bids, `false` for asks.
    is_bid: bool,
}

/// One-time publisher witness created at publish time.
public struct EXECUTOR has drop {}

// === Init ===

/// Initializes publish-time metadata by claiming and keeping the package publisher object.
fun init(publisher_witness: EXECUTOR, ctx: &mut TxContext) {
    package::claim_and_keep<EXECUTOR>(publisher_witness, ctx);
}

// === Public Functions ===

/// Creates a market maker executor for sender.
/// Call `deposit` to deposit Base/Quote into executor.
/// The executor is paused on creation. Call `unpause` to enable trading.
public fun create(market: Market, config: AMMConfig, ctx: &mut TxContext): (Executor, AdminCap) {
    let mut balance_manager = balance_manager::new(ctx);
    let deposit_cap = balance_manager.mint_deposit_cap(ctx);
    let withdraw_cap = balance_manager.mint_withdraw_cap(ctx);
    let trade_cap = balance_manager.mint_trade_cap(ctx);
    let id = object::new(ctx);
    let cap_id = object::new(ctx);

    events::emit_executor_created(id.to_inner(), cap_id.to_inner());

    let executor_cap = AdminCap { id: cap_id, executor_id: id.to_inner() };
    let executor = Executor {
        id,
        active: false,
        caps: Caps {
            trade_cap,
            deposit_cap,
            withdraw_cap,
        },
        balance_manager,
        market,
        config,
        info: info::empty(),
    };

    (executor, executor_cap)
}

/// Replaces AMM configuration. Resets the cached freshness state (Pyth publish timestamps
/// and last quoted mid / conf ratio) so the next `refresh_quotes_permissionless` call
/// re-prices unconditionally even when the oracle timestamp or value has not advanced.
/// Requires the matching market maker executor capability.
/// To reflect trading configuration immediately, `refresh_quotes_permissionless` (or the
/// admin `refresh_quotes`) should be called within a single PTB.
public fun update_config(self: &mut Executor, cap: &AdminCap, config: AMMConfig) {
    assert!(self.id() == cap.executor_id, EInvalidCap);
    assert!(&self.config != &config, EConfigUnchanged);

    events::emit_executor_config_updated(self.id());

    self.market.reset_freshness_state();
    self.config = config;
}

/// Pauses trading by cancelling all existing orders and preventing new orders until next activation.
public fun pause<BaseAsset, QuoteAsset>(
    self: &mut Executor,
    cap: &AdminCap,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(self.id() == cap.executor_id, EInvalidCap);
    assert!(self.active, EPaused);
    assert!(self.market.has_valid_pool(pool), EInvalidPool);

    // Generate trade proof.
    let trade_proof = self.balance_manager.generate_proof_as_trader(&self.caps.trade_cap, ctx);

    // Cancel all previous active orders.
    pool.cancel_all_orders(
        &mut self.balance_manager,
        &trade_proof,
        clock,
        ctx,
    );

    // Update balance manager, to reflect previous settled limit orders in balance.
    pool.withdraw_settled_amounts(&mut self.balance_manager, &trade_proof);

    // Update trading information.
    let volume_base = self.volume_base(pool);
    self
        .info
        .update(
            volume_base,
            self.balance_manager.balance<QuoteAsset>(),
            self.balance_manager.balance<BaseAsset>(),
        );

    // Emit paused event.
    events::emit_executor_paused(self.id());

    self.active = false;
}

/// Unpauses trading, allowing new orders to be placed.
public fun unpause(self: &mut Executor, cap: &AdminCap) {
    assert!(self.id() == cap.executor_id, EInvalidCap);
    assert!(!self.active, ENotPaused);

    // Emit unpaused event.
    events::emit_executor_unpaused(self.id());

    self.active = true;
}

/// Deposit funds into a balance manager.
/// Aborts unless `T` matches the configured base or quote asset.
/// Emits `Deposited` in addition to Deepbook's `BalanceEvent`.
public fun deposit<T>(self: &mut Executor, cap: &AdminCap, coin: Coin<T>, ctx: &mut TxContext) {
    assert!(self.id() == cap.executor_id, EInvalidCap);

    let coin_type = type_name::with_defining_ids<T>();
    let amount = coin.value();
    if (coin_type == self.market.base_type()) {
        self.info.record_base_deposit(amount);
    } else if (coin_type == self.market.quote_type()) {
        self.info.record_quote_deposit(amount);
    } else {
        abort EUnsupportedAsset
    };

    events::emit_deposited(self.id(), coin_type, amount);

    self.balance_manager.deposit_with_cap(&self.caps.deposit_cap, coin, ctx);
}

/// Withdraw funds from a balance manager.
/// Aborts unless `T` matches the configured base or quote asset.
/// Fails if the market maker executor is not paused.
/// Emits `Withdrawn` in addition to Deepbook's `BalanceEvent`.
///
/// NOTE: Pause step lets us settle all the balances before making the withdrawal.
/// Otherwise there is a high chance there is nothing to withdraw.
public fun withdraw<T>(
    self: &mut Executor,
    cap: &AdminCap,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(self.id() == cap.executor_id, EInvalidCap);
    assert!(!self.active, ENotPaused);

    let coin_type = type_name::with_defining_ids<T>();
    if (coin_type == self.market.base_type()) {
        self.info.record_base_withdraw(amount);
    } else if (coin_type == self.market.quote_type()) {
        self.info.record_quote_withdraw(amount);
    } else {
        abort EUnsupportedAsset
    };

    events::emit_withdrawn(self.id(), coin_type, amount);

    self.balance_manager.withdraw_with_cap(&self.caps.withdraw_cap, amount, ctx)
}

/// Withdraw all funds from a balance manager.
/// Aborts unless `T` matches the configured base or quote asset.
/// Fails if the market maker executor is not paused.
/// Emits `Withdrawn` in addition to Deepbook's `BalanceEvent`.
///
/// NOTE: Pause step lets us settle all the balances before making the withdrawal.
/// Otherwise there is a high chance there is nothing to withdraw.
public fun withdraw_all<T>(self: &mut Executor, cap: &AdminCap, ctx: &mut TxContext): Coin<T> {
    let amount = self.balance_manager.balance<T>();
    self.withdraw(cap, amount, ctx)
}

/// Public permissionless quote refresh entrypoint for bot-driven PTBs.
///
/// Flow:
/// 1) Read latest cached oracle prices from base and quote `PriceInfoObject`s.
/// 2) Cancel all stale orders for this account in the pool.
/// 3) Update balance based on all previously matched orders.
/// 4) Re-place four fresh orders (2 bids, 2 asks) around the oracle mid.
public fun refresh_quotes_permissionless<BaseAsset, QuoteAsset>(
    self: &mut Executor,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    base_price_info_object: &PriceInfoObject,
    quote_price_info_object: &PriceInfoObject,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Assert an input pool is valid.
    assert!(self.market.has_valid_pool(pool), EInvalidPool);
    // Assert trading is active.
    assert!(self.active, EPaused);
    // Assert Pyth price info objects have valid configured feed ids.
    assert!(
        self.market.has_valid_base_pyth_feed_id(base_price_info_object),
        EPythFeedIdentifierMismatch,
    );
    assert!(
        self.market.has_valid_quote_pyth_feed_id(quote_price_info_object),
        EPythFeedIdentifierMismatch,
    );

    // Get base and quote pyth prices not older than `max_price_age_secs`.
    let max_price_age_secs = self.config.max_price_age_secs();
    let base_pyth_price = pyth::get_price_no_older_than(
        base_price_info_object,
        clock,
        max_price_age_secs,
    );
    let quote_pyth_price = pyth::get_price_no_older_than(
        quote_price_info_object,
        clock,
        max_price_age_secs,
    );

    // Skip refresh only when both feeds are stale (neither feed timestamp advanced)
    // and there are open orders.
    // Protects from calling permissionless quote refresh with old pricing,
    // that would force the market maker to resubmit orders and lose priority.
    let has_open_orders = self.has_open_orders(pool);
    let is_price_updated = self.market.try_update_publish_times(base_pyth_price, quote_pyth_price);
    if (has_open_orders && !is_price_updated) {
        return
    };

    // Derive the DeepBook mid price and the combined confidence ratio (first-order linearized
    // uncertainty of Base/Quote = (Base/USD) / (Quote/USD)). The confidence ratio drives the
    // dynamic volatility buffer added on top of the base spread for the outer order.
    let (oracle_mid_price, conf_ratio_bps) = self
        .market
        .deepbook_price(
            base_pyth_price,
            quote_pyth_price,
            self.config.max_conf_ratio_bps(),
        );

    // Skip refresh when the new oracle inputs are within `stale_price_tolerance_bps` of the
    // last placed ones.
    // Defends against FIFO-priority on Pyth ticks that would barely move the ladder.
    let last_mid_price = self.market.mid_price();
    let last_conf_ratio_bps = self.market.conf_ratio_bps();
    if (has_open_orders && last_mid_price.is_some() && last_conf_ratio_bps.is_some()) {
        let is_within_tolerance = self
            .config
            .is_stale_tolerant(
                oracle_mid_price,
                conf_ratio_bps,
                last_mid_price.destroy_some(),
                last_conf_ratio_bps.destroy_some(),
            );
        if (is_within_tolerance) {
            return
        };
    };

    self.refresh_quotes_inner(pool, oracle_mid_price, conf_ratio_bps, clock, ctx);
}

/// Admin-gated quote refresh entrypoint that accepts a caller-supplied `mid_price` and
/// combined confidence ratio (`conf_ratio_bps`, in basis points) instead of reading the
/// Pyth oracle. Useful when quoting off off-chain market data (e.g. a CEX feed) is
/// preferable to the on-chain oracle. Requires the matching `AdminCap`.
///
/// Flow:
/// 1) Take caller-supplied `mid_price` and `conf_ratio_bps`.
/// 2) Cancel all stale orders for this account in the pool.
/// 3) Update balance based on all previously matched orders.
/// 4) Re-place four fresh orders (2 bids, 2 asks) around the supplied mid.
public fun refresh_quotes<BaseAsset, QuoteAsset>(
    self: &mut Executor,
    cap: &AdminCap,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    mid_price: u64,
    conf_ratio_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(self.id() == cap.executor_id, EInvalidCap);
    // Assert an input pool is valid.
    assert!(self.market.has_valid_pool(pool), EInvalidPool);
    // Assert trading is active.
    assert!(self.active, EPaused);

    self.refresh_quotes_inner(pool, mid_price, conf_ratio_bps, clock, ctx);
}

/// Cancels stale orders, settles balances, derives the reservation mid and base/volatility
/// spreads from the supplied `oracle_mid_price` and combined `conf_ratio_bps`, then re-places
/// the four-order ladder around the reservation mid.
///
/// Flow:
/// 1) Cancel all stale orders for this account in the pool.
/// 2) Update balance based on all previously matched orders.
/// 3) Compute the reservation mid plus base/volatility spreads.
/// 4) Re-place four fresh orders (2 bids, 2 asks) around the reservation mid.
fun refresh_quotes_inner<BaseAsset, QuoteAsset>(
    self: &mut Executor,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    oracle_mid_price: u64,
    conf_ratio_bps: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    // Generate trade proof.
    let trade_proof = self.balance_manager.generate_proof_as_trader(&self.caps.trade_cap, ctx);

    // Cancel all previous active orders.
    pool.cancel_all_orders(
        &mut self.balance_manager,
        &trade_proof,
        clock,
        ctx,
    );

    // Update balance manager to reflect previous settled limit orders in balance,
    // before using balance in quantity computation for the next orders.
    pool.withdraw_settled_amounts(&mut self.balance_manager, &trade_proof);

    // Calculate spreads for the following limit orders.
    let base_spread = self.config.base_spread(oracle_mid_price);
    let volatility_spread = self.config.outer_spread(oracle_mid_price, conf_ratio_bps);

    // Read current balances (post-settlement) and derive the reservation mid: the oracle mid
    // shifted toward the side that rebalances the book (bounded by base_spread).
    let base_balance = self.balance_manager.balance<BaseAsset>();
    let quote_balance = self.balance_manager.balance<QuoteAsset>();
    let reservation_mid = self
        .config
        .reservation_mid(oracle_mid_price, base_balance, quote_balance);

    // Fetch deepbook's pool parameters.
    let (tick, lot_size, _) = pool.pool_book_params();

    // Calculate bid/ask order prices around the reservation mid so the quote ladder leans
    // toward rebalancing the inventory (spreads remain scaled off the oracle mid).
    let bid_outer = compute_bid_price(reservation_mid, volatility_spread, tick);
    let bid_inner = compute_bid_price(reservation_mid, base_spread, tick);
    let ask_inner = compute_ask_price(reservation_mid, base_spread, tick);
    let ask_outer = compute_ask_price(reservation_mid, volatility_spread, tick);

    // Cancel outer bid/ask when equal to inner.
    let cancel_outer_bid = bid_outer == bid_inner;
    let cancel_outer_ask = ask_outer == ask_inner;

    // Split bid order balance between inner and outer spread per the configured
    // `outer_balance_bps`, and compute quantity in base asset (for deepbook limit order).
    let bid_outer_quantity_quote = if (cancel_outer_bid) { 0 } else {
        self.config.outer_balance(quote_balance)
    };
    let bid_inner_quantity_quote = quote_balance - bid_outer_quantity_quote;
    let bid_outer_quantity = round_down_quantity(
        quote_to_base_quantity(bid_outer_quantity_quote, bid_outer),
        lot_size,
    );
    let bid_inner_quantity = round_down_quantity(
        quote_to_base_quantity(bid_inner_quantity_quote, bid_inner),
        lot_size,
    );

    // Split ask order balance between inner and outer spread per the configured
    // `outer_balance_bps`.
    let ask_outer_quantity = if (cancel_outer_ask) { 0 } else {
        self.config.outer_balance(base_balance)
    };
    let ask_inner_quantity = base_balance - ask_outer_quantity;
    let ask_outer_quantity = round_down_quantity(ask_outer_quantity, lot_size);
    let ask_inner_quantity = round_down_quantity(ask_inner_quantity, lot_size);

    // Update trading information.
    let volume_base = self.volume_base(pool);
    self
        .info
        .update(
            volume_base,
            quote_balance,
            base_balance,
        );

    // Try to place 4 limit orders (2 bids + 2 asks) around the reservation mid.
    // Skipped if quantity is below the limit.
    let order_params = vector[
        LimitOrderParams { price: bid_outer, quantity: bid_outer_quantity, is_bid: true },
        LimitOrderParams { price: bid_inner, quantity: bid_inner_quantity, is_bid: true },
        LimitOrderParams { price: ask_inner, quantity: ask_inner_quantity, is_bid: false },
        LimitOrderParams { price: ask_outer, quantity: ask_outer_quantity, is_bid: false },
    ];
    let orders = self.try_place_limit_orders(pool, &trade_proof, order_params, clock, ctx);

    // Cache price and confidence that drove this placement, so the permissionless-refresh
    // skip guard can compare them against the next call's oracle inputs.
    self.market.set_price_and_conf(oracle_mid_price, conf_ratio_bps);

    events::emit_quote_updated(self.id(), oracle_mid_price, orders);
}

// === View helpers ===

/// Returns the market maker executor ID.
public fun id(self: &Executor): ID {
    self.id.to_inner()
}

/// Returns the market maker executor owner.
public fun owner(self: &Executor): address {
    self.balance_manager.owner()
}

/// Returns the balance manager.
public fun balance_manager(self: &Executor): &BalanceManager {
    &self.balance_manager
}

/// Returns the DeepBook trade cap ID.
public fun trade_cap_id(self: &Executor): ID {
    object::id(&self.caps.trade_cap)
}

/// Returns the DeepBook deposit cap ID.
public fun deposit_cap_id(self: &Executor): ID {
    object::id(&self.caps.deposit_cap)
}

/// Returns the DeepBook withdraw cap ID.
public fun withdraw_cap_id(self: &Executor): ID {
    object::id(&self.caps.withdraw_cap)
}

/// Returns the configured market metadata.
public fun market(self: &Executor): &Market {
    &self.market
}

/// Returns the current market maker configuration.
public fun config(self: &Executor): &AMMConfig {
    &self.config
}

/// Returns whether trading is active.
public fun active(self: &Executor): bool {
    self.active
}

/// Returns the market maker executor accounting info.
public fun info(self: &Executor): &Info {
    &self.info
}

/// Returns the market maker executor capability object ID.
public fun cap_id(amm_cap: &AdminCap): ID {
    amm_cap.id.to_inner()
}

// === Private Functions ===

/// Returns whether there are open orders for the executor in the pool.
fun has_open_orders<BaseAsset, QuoteAsset>(
    self: &Executor,
    pool: &Pool<BaseAsset, QuoteAsset>,
): bool {
    pool.account_exists(&self.balance_manager) && !pool.account(&self.balance_manager).open_orders().is_empty()
}

/// Returns the current epoch's base-asset volume from DeepBook,
/// or `0` if the account has not been created yet in the pool's state.
fun volume_base<BaseAsset, QuoteAsset>(self: &Executor, pool: &Pool<BaseAsset, QuoteAsset>): u128 {
    if (pool.account_exists(&self.balance_manager)) {
        pool.account(&self.balance_manager).total_volume()
    } else {
        0
    }
}

/// Compute bid price based on `mid_price` and `spread`
/// to match deepbook's allowed `tick` size
/// (rounding outside `mid_price`).
/// Aborts if less than a min price.
fun compute_bid_price(mid_price: u64, spread: u64, tick: u64): u64 {
    // Compute precise bid price.
    let bid = mid_price.checked_sub(spread).destroy_or!(abort EPriceUnderflow);

    // Round down bid to the nearest tick and assert min price constraint.
    let bid = bid - bid % tick;
    assert!(bid >= constants::min_price(), EPriceUnderflow);

    bid
}

/// Compute ask price based on `mid_price`, `spread`
/// to match deepbook's allowed `tick` size
/// (rounding outside `mid_price`).
/// Aborts if more than a max price.
fun compute_ask_price(mid_price: u64, spread: u64, tick: u64): u64 {
    // Compute precise ask price.
    let ask = mid_price.checked_add(spread).destroy_or!(abort EPriceOverflow);

    // Round up ask to the nearest tick and assert max price constraint.
    let rem = ask % tick;
    let ask = if (rem == 0) {
        ask
    } else {
        ask.checked_add(tick - rem).destroy_or!(abort EPriceOverflow)
    };
    assert!(ask <= constants::max_price(), EPriceOverflow);

    ask
}

/// Round down order `quantity` to match deepbook's `lot_size`.
fun round_down_quantity(quantity: u64, lot_size: u64): u64 {
    quantity - quantity % lot_size
}

/// Place a batch of limit orders. Each candidate whose quantity is below the pool's `min_size`
/// is skipped silently. Returns the snapshots of successfully-placed orders in the same
/// relative order as their candidates; the `client_order_id` of each is the candidate's 1-based
/// index, preserved across skips so the i-th slot still maps to the i-th candidate.
fun try_place_limit_orders<BaseAsset, QuoteAsset>(
    self: &mut Executor,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    trade_proof: &TradeProof,
    candidates: vector<LimitOrderParams>,
    clock: &Clock,
    ctx: &TxContext,
): vector<events::LimitOrder> {
    let (_, _, min_size) = pool.pool_book_params();

    // Self-matching should not happen (if it does due to a logic error, abort the taker order).
    let self_matching_option = constants::cancel_taker();
    let expire_timestamp = clock.timestamp_ms() + self.config.order_expiration_time_ms();
    let pay_with_deep = false;
    let order_type = if (self.config.post_only()) {
        // `post_only` aborts the whole refresh if any order would cross the resting book.
        constants::post_only()
    } else {
        // `no_restriction` lets the crossing portion execute
        // as a taker against external liquidity.
        constants::no_restriction()
    };

    let mut placed = vector[];
    let mut index = 0;
    while (index < candidates.length()) {
        let LimitOrderParams { price, quantity, is_bid } = candidates[index];
        index = index + 1;

        // Don't place if quantity is low.
        if (quantity < min_size) continue;

        let order_info = pool.place_limit_order(
            &mut self.balance_manager,
            trade_proof,
            // 1-based client_order_id
            index,
            order_type,
            self_matching_option,
            price,
            quantity,
            is_bid,
            pay_with_deep,
            expire_timestamp,
            clock,
            ctx,
        );

        // Add order info to placed output.
        placed.push_back(events::new_order(order_info.order_id(), price, quantity, is_bid));
    };

    placed
}

/// Converts a quote asset quantity to a base asset quantity using the given deepbook's price.
///
/// NOTE: Quote to base quantity conversion computed as:
/// deepbook_price = deepbook_price_mantissa / FLOAT_SCALING
/// quantity_base = quantity_quote / deepbook_price
/// => quantity_base = quantity_quote * FLOAT_SCALING / deepbook_price_mantissa
fun quote_to_base_quantity(quote_quantity: u64, deepbook_price: u64): u64 {
    ((quote_quantity as u128) * constants::float_scaling_u128() / (deepbook_price as u128))
        .try_as_u64()
        .destroy_or!(abort EInvalidQuantity)
}

// === Test-Only Helpers ===

/// Creates the package witness and runs init for tests.
#[test_only]
public fun test_init(ctx: &mut TxContext) {
    let publisher_witness = sui::test_utils::create_one_time_witness<EXECUTOR>();
    init(
        publisher_witness,
        ctx,
    );
}
