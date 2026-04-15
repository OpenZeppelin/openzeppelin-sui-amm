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
use pyth::price::Price;
use pyth::price_info::PriceInfoObject;
use pyth::pyth;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::coin_registry::Currency;
use sui::package;

// === Errors ===

#[error(code = 0)]
const EPythPriceNonPositive: vector<u8> = "pyth price must be positive";
#[error(code = 1)]
const EPythExponentNonNegative: vector<u8> = "pyth price exponent_u128 must be negative";
#[error(code = 2)]
const ExponentTooLarge: vector<u8> = "price exponent too large";
#[error(code = 3)]
const EPythInvalidPriceValue: vector<u8> = "pyth price must be of valid size";
#[error(code = 4)]
const EPythFeedIdentifierMismatch: vector<u8> = "pyth feed identifier mismatch";
#[error(code = 5)]
const ETickIsTooLarge: vector<u8> = "deepbook pool tick size is too large for price calculation";
#[error(code = 6)]
const EInvalidPool: vector<u8> = "pool does not match the associated pool";
#[error(code = 7)]
const EInvalidCap: vector<u8> = "invalid market maker cap";
#[error(code = 8)]
const EPaused: vector<u8> = "trading paused";
#[error(code = 9)]
const ENotPaused: vector<u8> = "trading not paused";
#[error(code = 10)]
const EInvalidPoolUpdate: vector<u8> = "should update pool while trading paused";
#[error(code = 11)]
const EInvalidQuantity: vector<u8> = "can't place order due to invalid quantity";
#[error(code = 12)]
const EPythPriceConfidenceTooWide: vector<u8> = "pyth price confidence interval is too wide";

// === Constants ===

const MAX_DECIMAL_POWER: u8 = 38;
const HUNDRED_PERCENT_BPS_U128: u128 = 10_000;

// === Structs ===

/// Capability required to update configuration.
public struct AdminCap has key, store {
    /// Unique ID for the market maker capability object.
    id: UID,
    /// ID of the associated market maker.
    executor_id: ID,
}

/// Per-market maker state.
public struct MarketMaker has key, store {
    /// Unique ID for the account object.
    id: UID,
    /// Deepbook capabilities retained by the owner.
    caps: Caps,
    /// Balance manager linked to the market maker.
    balance_manager: BalanceManager,
    /// Pool onchain configuration.
    config: AMMConfig,
}

/// Balance manager caps owned by the market maker owner.
public struct Caps has store {
    /// Deepbook's trade capability.
    trade_cap: TradeCap,
    /// Deepbook's deposit capability.
    deposit_cap: DepositCap,
    /// Deepbook's withdraw capability.
    withdraw_cap: WithdrawCap,
}

// === Init ===

/// One-time publisher witness created at publish time.
public struct EXECUTOR has drop {}

/// Initializes publish-time metadata by claiming and keeping the package publisher object.
fun init(publisher_witness: EXECUTOR, ctx: &mut TxContext) {
    package::claim_and_keep<EXECUTOR>(publisher_witness, ctx);
}

// === Public Functions ===

/// Creates a market maker for sender.
public fun create(config: AMMConfig, ctx: &mut TxContext): (MarketMaker, AdminCap) {
    let mut balance_manager = balance_manager::new(ctx);
    let deposit_cap = balance_manager.mint_deposit_cap(ctx);
    let withdraw_cap = balance_manager.mint_withdraw_cap(ctx);
    let trade_cap = balance_manager.mint_trade_cap(ctx);
    let id = object::new(ctx);

    events::emit_market_maker_created(id.to_inner());

    let market_maker_cap = AdminCap { id: object::new(ctx), executor_id: id.to_inner() };
    let market_maker = MarketMaker {
        id,
        caps: Caps {
            trade_cap,
            deposit_cap,
            withdraw_cap,
        },
        balance_manager,
        config,
    };

    (market_maker, market_maker_cap)
}

/// Replaces the market maker configuration, and unpause trading.
/// Requires the matching market maker capability.
public fun update_market_maker(market_maker: &mut MarketMaker, cap: &AdminCap, config: AMMConfig) {
    assert!(market_maker.id() == cap.executor_id, EInvalidCap);

    // When market maker active,
    if (market_maker.config.active()) {
        // assert we don't update pool (to settle balances properly).
        assert!(market_maker.config.pool_id() == config.pool_id(), EInvalidPoolUpdate);
    } else {
        // Otherwise emit unpaused event, since `AMMConfig` can be created active only.
        events::emit_market_maker_unpaused(market_maker.id());
    };

    events::emit_market_maker_config_updated(market_maker.id());

    market_maker.config = config;
}

/// Pauses trading by cancelling all existing orders and preventing new orders until next activation.
public fun pause<BaseAsset, QuoteAsset>(
    market_maker: &mut MarketMaker,
    cap: &AdminCap,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(market_maker.id() == cap.executor_id, EInvalidCap);
    assert!(market_maker.config.active(), EPaused);
    assert!(market_maker.config.has_valid_pool(pool), EInvalidPool);

    // Generate trade proof.
    let trade_proof = market_maker
        .balance_manager
        .generate_proof_as_trader(&market_maker.caps.trade_cap, ctx);

    // Cancel all previous active orders.
    pool.cancel_all_orders(
        &mut market_maker.balance_manager,
        &trade_proof,
        clock,
        ctx,
    );

    // Update balance manager, to reflect previous settled limit orders in balance.
    pool.withdraw_settled_amounts(&mut market_maker.balance_manager, &trade_proof);

    // Emit paused event.
    events::emit_market_maker_paused(market_maker.id());

    // Pause config.
    market_maker.config.pause();
}

/// Unpauses trading, allowing new orders to be placed.
public fun unpause(market_maker: &mut MarketMaker, cap: &AdminCap) {
    assert!(market_maker.id() == cap.executor_id, EInvalidCap);
    assert!(!market_maker.config.active(), ENotPaused);

    // Emit unpaused event.
    events::emit_market_maker_unpaused(market_maker.id());

    // Unpause config.
    market_maker.config.unpause();
}

/// Deposit funds into a balance manager.
/// Deepbook's `BalanceEvent` emitted after successful deposit.
public fun deposit<T>(
    market_maker: &mut MarketMaker,
    cap: &AdminCap,
    coin: Coin<T>,
    ctx: &mut TxContext,
) {
    assert!(market_maker.id() == cap.executor_id, EInvalidCap);

    market_maker.balance_manager.deposit_with_cap(&market_maker.caps.deposit_cap, coin, ctx)
}

/// Withdraw funds from a balance manager.
/// Fails if `MarketMaker` is not paused.
/// Deepbook's `BalanceEvent` emitted after successful withdrawal.
///
/// NOTE: Pause step let us settle all the balances before making withdrawal.
/// Otherwise there is a high chance there is nothing to withdraw.
public fun withdraw<T>(
    market_maker: &mut MarketMaker,
    cap: &AdminCap,
    withdraw_amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(market_maker.id() == cap.executor_id, EInvalidCap);
    assert!(!market_maker.config.active(), ENotPaused);

    market_maker
        .balance_manager
        .withdraw_with_cap(&market_maker.caps.withdraw_cap, withdraw_amount, ctx)
}

/// Public quote refresh entrypoint for bot-driven PTBs.
///
/// Flow:
/// 1) Read latest cached oracle prices from base and quote `PriceInfoObject`s.
/// 2) Cancel all stale orders for this account in the pool.
/// 3) Update balance based on all previously matched orders.
/// 4) Re-place four fresh orders (2 bids, 2 asks) around the oracle mid.
public fun refresh_quotes<BaseAsset, QuoteAsset>(
    market_maker: &mut MarketMaker,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    base_currency: &Currency<BaseAsset>,
    quote_currency: &Currency<QuoteAsset>,
    base_price_info_object: &PriceInfoObject,
    quote_price_info_object: &PriceInfoObject,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Assert an input pool is valid.
    assert!(market_maker.config.has_valid_pool(pool), EInvalidPool);
    // Assert trading is active.
    assert!(market_maker.config.active(), EPaused);
    // Assert Pyth price info objects have valid configured feed ids.
    assert!(
        market_maker.config.has_valid_base_pyth_feed_id(base_price_info_object),
        EPythFeedIdentifierMismatch,
    );
    assert!(
        market_maker.config.has_valid_quote_pyth_feed_id(quote_price_info_object),
        EPythFeedIdentifierMismatch,
    );

    // Get base and quote pyth prices not older than `max_price_age_secs`.
    let max_price_age_secs = market_maker.config.max_price_age_secs();
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

    // Skip refresh only when both feeds are stale (neither feed timestamp advanced).
    // Protects from calling permissionless quote refresh with old pricing,
    // that will force market maker resubmit orders and loose priority.
    let is_price_stale =
        market_maker.is_base_price_stale(base_pyth_price) 
        && market_maker.is_quote_price_stale(quote_pyth_price);
    if (is_price_stale) {
        return
    };
    market_maker.config.set_base_price_publish_time(base_pyth_price.get_timestamp());
    market_maker.config.set_quote_price_publish_time(quote_pyth_price.get_timestamp());

    // Calculate precise spreads using Base/Quote = (Base/USD) / (Quote/USD).
    let oracle_mid_price = deepbook_price(
        base_pyth_price,
        quote_pyth_price,
        base_currency.decimals(),
        quote_currency.decimals(),
        market_maker.config.max_conf_ratio_bps(),
    );
    let base_spread = market_maker.config.base_spread(oracle_mid_price);
    let volatility_spread = market_maker.config.volatility_spread(oracle_mid_price);

    // Fetch deepbook's pool parameters.
    let (tick, lot_size, min_size) = pool.pool_book_params();

    // Calculate bids/ask order prices.
    let bid_inner = compute_bid_price(oracle_mid_price, base_spread, tick);
    let bid_outer = compute_bid_price(oracle_mid_price, volatility_spread, tick);
    let ask_inner = compute_ask_price(oracle_mid_price, base_spread, tick);
    let ask_outer = compute_ask_price(oracle_mid_price, volatility_spread, tick);

    // Split bid order balance equally (almost xD) between inner and outer spread,
    // and compute quantity in base asset (for deepbook limit order).
    let quote_balance = market_maker.balance_manager.balance<QuoteAsset>();
    let bid_outer_quantity_quote = quote_balance / 2;
    let bid_inner_quantity_quote = quote_balance - bid_outer_quantity_quote;
    let bid_outer_quantity = compute_quantity(
        quote_to_base_quantity(bid_outer_quantity_quote, bid_outer),
        lot_size,
        min_size,
    );
    let bid_inner_quantity = compute_quantity(
        quote_to_base_quantity(bid_inner_quantity_quote, bid_inner),
        lot_size,
        min_size,
    );

    // Split ask order balance equally between inner and outer spread.
    let base_balance = market_maker.balance_manager.balance<BaseAsset>();
    let ask_outer_raw = base_balance / 2;
    let ask_inner_raw = base_balance - ask_outer_raw;
    let ask_outer_quantity = compute_quantity(ask_outer_raw, lot_size, min_size);
    let ask_inner_quantity = compute_quantity(ask_inner_raw, lot_size, min_size);

    // Generate trade proof.
    let trade_proof = market_maker
        .balance_manager
        .generate_proof_as_trader(&market_maker.caps.trade_cap, ctx);

    // Cancel all previous active orders.
    pool.cancel_all_orders(
        &mut market_maker.balance_manager,
        &trade_proof,
        clock,
        ctx,
    );

    // Update balance manager, to reflect previous settled limit orders in balance.
    pool.withdraw_settled_amounts(&mut market_maker.balance_manager, &trade_proof);

    // Place 4 limit orders (2 bids and 2 ask) based on current price and volatility parameters.
    market_maker.try_place_limit_order(
        pool,
        &trade_proof,
        1,
        bid_outer,
        bid_outer_quantity,
        true,
        clock,
        ctx,
    );
    market_maker.try_place_limit_order(
        pool,
        &trade_proof,
        2,
        bid_inner,
        bid_inner_quantity,
        true,
        clock,
        ctx,
    );
    market_maker.try_place_limit_order(
        pool,
        &trade_proof,
        3,
        ask_inner,
        ask_inner_quantity,
        false,
        clock,
        ctx,
    );
    market_maker.try_place_limit_order(
        pool,
        &trade_proof,
        4,
        ask_outer,
        ask_outer_quantity,
        false,
        clock,
        ctx,
    );

    events::emit_quote_updated(
        oracle_mid_price,
        market_maker.config.base_spread_bps(),
        market_maker.config.volatility_spread_bps(),
    );
}

// === View Functions ===

/// Returns the market maker ID.
public fun id(market_maker: &MarketMaker): ID {
    market_maker.id.to_inner()
}

/// Returns the market maker owner.
public fun owner(market_maker: &MarketMaker): address {
    market_maker.balance_manager.owner()
}

/// Returns the balance manager.
public fun balance_manager(market_maker: &MarketMaker): &BalanceManager {
    &market_maker.balance_manager
}

/// Returns a deepbook's trade cap ID.
public fun trade_cap_id(market_maker: &MarketMaker): ID {
    object::id(&market_maker.caps.trade_cap)
}

/// Returns a deepbook's deposit cap ID.
public fun deposit_cap_id(market_maker: &MarketMaker): ID {
    object::id(&market_maker.caps.deposit_cap)
}

/// Returns a deepbook's withdraw cap ID.
public fun withdraw_cap_id(market_maker: &MarketMaker): ID {
    object::id(&market_maker.caps.withdraw_cap)
}

/// Returns the current market maker configuration.
public fun config(market_maker: &MarketMaker): &AMMConfig {
    &market_maker.config
}

/// Returns the market maker capability object ID.
public fun cap_id(amm_cap: &AdminCap): ID {
    amm_cap.id.to_inner()
}

// === Private Functions ===

/// Returns true when the cached base price publish time is at least as recent as the incoming
/// price timestamp, meaning the base feed has not advanced.
fun is_base_price_stale(market_maker: &MarketMaker, price: Price): bool {
    market_maker
        .config
        .base_price_publish_time()
        .map!(|publish_time| publish_time >= price.get_timestamp())
        .destroy_or!(false)
}

/// Returns true when the cached quote price publish time is at least as recent as the incoming
/// price timestamp, meaning the quote feed has not advanced.
fun is_quote_price_stale(market_maker: &MarketMaker, price: Price): bool {
    market_maker
        .config
        .quote_price_publish_time()
        .map!(|publish_time| publish_time >= price.get_timestamp())
        .destroy_or!(false)
}

/// Compute bid price based on `mid_price`, `spread`
/// to match deepbook's allowed `tick` size
/// (rounding outside `mid_price`)
/// Computed bid should not be more than a `mid_price`
fun compute_bid_price(mid_price: u64, spread: u64, tick: u64): u64 {
    // Min price is one `tick` higher than deepbook's `min_price`
    // to avoid rounding down error.
    let min_price = constants::min_price().checked_add(tick).destroy_or!(abort ETickIsTooLarge);

    // Compute the maximal allowed bid price.
    let bid = mid_price.checked_sub(spread).destroy_or!(min_price).max(min_price);

    // Round down the bid to the nearest tick.
    bid - bid % tick
}

/// Compute ask size based on `mid_price`, `spread`
/// to match deepbook's allowed `tick` size
/// (rounding outside `mid_price`).
/// Computed ask will not be less than a `mid_price`.
fun compute_ask_price(mid_price: u64, spread: u64, tick: u64): u64 {
    // Max price is one `tick` lower than deepbook's `max_price`
    // to avoid rounding up error.
    let max_price = constants::max_price().checked_sub(tick).destroy_or!(abort ETickIsTooLarge);

    // Compute the minimum allowed ask price.
    let ask = mid_price.checked_add(spread).destroy_or!(max_price).min(max_price);

    // Round up the ask price to the nearest tick.
    let rem = ask % tick;
    if (rem == 0) {
        ask
    } else {
        ask + tick - rem
    }
}

/// Round down order `quantity` to match deepbook's `lot_size`.
/// Return `0` if quantity less than min_size.
fun compute_quantity(quantity: u64, lot_size: u64, min_size: u64): u64 {
    let quantity = quantity - quantity % lot_size;
    if (quantity >= min_size) {
        quantity
    } else {
        0
    }
}

/// Helper function to place a limit order if quantity is non-zero.
fun try_place_limit_order<BaseAsset, QuoteAsset>(
    market_maker: &mut MarketMaker,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    trade_proof: &TradeProof,
    client_order_id: u64,
    price: u64,
    quantity: u64,
    is_bid: bool,
    clock: &Clock,
    ctx: &TxContext,
) {
    // Don't place an order if quantity is zero.
    if (quantity == 0) {
        return
    };

    // Self matching should not happen (if happens due to logic error abort taker order).
    let self_matching_option = constants::cancel_taker();
    let expire_timestamp = clock.timestamp_ms() + market_maker.config.order_expiration_time_ms();
    let pay_with_deep = false;
    let order_type = constants::no_restriction();

    // Place a limit order.
    pool.place_limit_order(
        &mut market_maker.balance_manager,
        trade_proof,
        client_order_id,
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
}

/// Extract positive USD mantissa (can be safely cast to u64) and negative exponent from a Pyth price.
fun deepbook_usd_price(price: Price, max_conf_ratio_bps: u64): (u128, u8) {
    // Retrieve positive mantissa.
    let price_i64 = price.get_price();
    assert!(!price_i64.get_is_negative(), EPythPriceNonPositive);
    let mantissa = price_i64.get_magnitude_if_positive() as u128;
    assert!(mantissa != 0, EPythPriceNonPositive);

    // Reject prices whose confidence interval is too wide relative to the price.
    let max_conf_ratio_bps = max_conf_ratio_bps as u128;
    let price_conf = price.get_conf() as u128;
    assert!(
        price_conf * HUNDRED_PERCENT_BPS_U128 <= mantissa * max_conf_ratio_bps,
        EPythPriceConfidenceTooWide,
    );

    // Retrieve negative exponent.
    let expo_i64 = price.get_expo();
    assert!(expo_i64.get_is_negative(), EPythExponentNonNegative);
    let exponent = expo_i64
        .get_magnitude_if_negative()
        .try_as_u8()
        .destroy_or!(abort ExponentTooLarge);
    assert!(exponent <= MAX_DECIMAL_POWER, ExponentTooLarge);

    (mantissa, exponent)
}

/// Derive the DeepBook base/quote price from base and quote USD prices.
fun deepbook_price(
    base_price: Price,
    quote_price: Price,
    base_decimals: u8,
    quote_decimals: u8,
    max_conf_ratio_bps: u64,
): u64 {
    assert!(base_decimals <= MAX_DECIMAL_POWER, ExponentTooLarge);
    assert!(quote_decimals <= MAX_DECIMAL_POWER, ExponentTooLarge);

    let (base_mantissa, base_exponent) = deepbook_usd_price(base_price, max_conf_ratio_bps);
    let (quote_mantissa, quote_exponent) = deepbook_usd_price(quote_price, max_conf_ratio_bps);

    // Convert (Base/USD)/(Quote/USD) to DeepBook price units (quote atoms per base atom),
    // including decimal adjustment for token atom precision mismatch.
    let mut numerator = base_mantissa * constants::float_scaling_u128();
    let mut denominator = quote_mantissa;
    let quote_total = quote_exponent + quote_decimals;
    let base_total = base_exponent + base_decimals;
    if (quote_total >= base_total) {
        numerator = numerator * 10_u128.pow(quote_total - base_total);
    } else {
        denominator = denominator * 10_u128.pow(base_total - quote_total);
    };
    let deepbook_price = (numerator / denominator)
        .try_as_u64()
        .destroy_or!(abort EPythInvalidPriceValue);

    assert!(deepbook_price >= constants::min_price(), EPythInvalidPriceValue);
    assert!(deepbook_price <= constants::max_price(), EPythInvalidPriceValue);

    deepbook_price
}

/// Converts a quote asset quantity to a base asset quantity using the given deepbook's price.
///
/// NOTE:
/// deepbook_price = deepbook_price_mantissa / FLOAT_SCALING
/// quantity_base = quantity_quote / deepbook_price
/// => quantity_base = quantity_quote * FLOAT_SCALING / deepbook_price_mantissa
fun quote_to_base_quantity(quote_quantity: u64, deepbook_price: u64): u64 {
    ((quote_quantity as u128) * constants::float_scaling_u128() / (deepbook_price as u128))
        .try_as_u64()
        .destroy_or!(abort EInvalidQuantity)
}

// === Test-Only Helpers ===

#[test_only]
/// Creates the package witness and runs init for tests.
public fun test_init(ctx: &mut TxContext) {
    let publisher_witness = sui::test_utils::create_one_time_witness<EXECUTOR>();
    init(
        publisher_witness,
        ctx,
    );
}
