/// AMM logic.
module openzeppelin_market_maker::market_maker;

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
use openzeppelin_market_maker::config::MarketMakerConfig;
use openzeppelin_market_maker::events;
use pyth::price_info::PriceInfoObject;
use pyth::pyth;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::package;

// === Errors ===

#[error(code = 0)]
const EPythPriceNonPositive: vector<u8> = "pyth price must be positive";
#[error(code = 1)]
const EPythExponentNonNegative: vector<u8> = "pyth price exponent_u128 must be negative";
#[error(code = 2)]
const EPythExponentTooLarge: vector<u8> = "pyth price exponent_u128 should fit in u8";
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

// === Constants ===

// TODO#q: move to configuration
const ORDER_EXPIRATION_TIME_MS: u64 = 30_000;
const MAX_PRICE_AGE_SECS: u64 = 30;
const MAX_DECIMAL_POWER: u8 = 38;

// === Structs ===

/// Capability required to update configuration.
public struct MarketMakerCap has key, store {
    /// Unique ID for the market maker capability object.
    id: UID,
    /// ID of the associated market maker.
    market_maker_id: ID,
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
    config: MarketMakerConfig,
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
public struct MARKET_MAKER has drop {}

/// Initializes publish-time metadata by claiming and keeping the package publisher object.
fun init(publisher_witness: MARKET_MAKER, ctx: &mut TxContext) {
    package::claim_and_keep<MARKET_MAKER>(publisher_witness, ctx);
}

// === Public Functions ===

/// Creates a market maker for sender.
public fun create(config: MarketMakerConfig, ctx: &mut TxContext): (MarketMaker, MarketMakerCap) {
    let mut balance_manager = balance_manager::new(ctx);
    let deposit_cap = balance_manager.mint_deposit_cap(ctx);
    let withdraw_cap = balance_manager.mint_withdraw_cap(ctx);
    let trade_cap = balance_manager.mint_trade_cap(ctx);
    let id = object::new(ctx);

    events::emit_market_maker_created(id.to_inner());

    let market_maker_cap = MarketMakerCap { id: object::new(ctx), market_maker_id: id.to_inner() };
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

/// Replaces the market maker configuration. Requires the matching market maker capability.
public fun update_market_maker(
    market_maker: &mut MarketMaker,
    cap: &MarketMakerCap,
    config: MarketMakerConfig,
) {
    assert!(market_maker.id.to_inner() == cap.market_maker_id, EInvalidCap);
    // Should update pool when trading is paused (to settle balances properly).
    if (market_maker.config.active()) {
        assert!(market_maker.config.pool_id() == config.pool_id(), EInvalidPoolUpdate)
    };

    // TODO#q: think what we can do when dropping old value.
    market_maker.config = config;
    // TODO#q: nullify timestamp updates.
    // TODO#q: emit event on update.
}

/// Pauses trading by cancelling all existing orders and preventing new orders until next activation.
public fun pause<BaseAsset, QuoteAsset>(
    market_maker: &mut MarketMaker,
    cap: &MarketMakerCap,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(market_maker.id.to_inner() == cap.market_maker_id, EInvalidCap);
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

    // Pause config.
    market_maker.config.pause();
}

/// Unpauses trading, allowing new orders to be placed.
public fun unpause(market_maker: &mut MarketMaker, cap: &MarketMakerCap) {
    assert!(market_maker.id.to_inner() == cap.market_maker_id, EInvalidCap);
    assert!(!market_maker.config.active(), ENotPaused);

    // Unpause config.
    market_maker.config.unpause();
}

/// Deposit funds into a balance manager.
public fun deposit<T>(
    market_maker: &mut MarketMaker,
    cap: &MarketMakerCap,
    coin: Coin<T>,
    ctx: &mut TxContext,
) {
    assert!(market_maker.id.to_inner() == cap.market_maker_id, EInvalidCap);

    market_maker.balance_manager.deposit_with_cap(&market_maker.caps.deposit_cap, coin, ctx)
}

/// Withdraw funds from a balance manager.
public fun withdraw<T>(
    market_maker: &mut MarketMaker,
    cap: &MarketMakerCap,
    withdraw_amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(market_maker.id.to_inner() == cap.market_maker_id, EInvalidCap);

    market_maker
        .balance_manager
        .withdraw_with_cap(&market_maker.caps.withdraw_cap, withdraw_amount, ctx)
}

/// Public quote refresh entrypoint for bot-driven PTBs.
///
/// Flow:
/// 1) Read latest cached oracle price from `price_info_object`.
/// 2) Cancel all stale orders for this account in the pool.
/// 3) Update balance based on all previously matched orders.
/// 4) Re-place four fresh orders (2 bids, 2 asks) around the oracle mid.
public fun refresh_quotes<BaseAsset, QuoteAsset>(
    market_maker: &mut MarketMaker,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    // TODO#q: add PriceInfoObject for base and quote asset
    price_info_object: &PriceInfoObject,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Assert an input pool is valid.
    assert!(market_maker.config.has_valid_pool(pool), EInvalidPool);
    // Assert trading is active.
    assert!(market_maker.config.active(), EPaused);

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

    // Calculate base and volatility spread values.
    let oracle_mid_price = deepbook_price(price_info_object, &market_maker.config, clock);
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
    let asset_balance_quote = market_maker.balance_manager.balance<QuoteAsset>();
    let bid_outer_quantity_quote = asset_balance_quote / 2;
    let bid_inner_quantity_quote = asset_balance_quote - bid_outer_quantity_quote;
    let bid_outer_quantity = compute_quantity(
        bid_outer_quantity_quote / bid_outer,
        lot_size,
        min_size,
    );
    let bid_inner_quantity = compute_quantity(
        bid_inner_quantity_quote / bid_inner,
        lot_size,
        min_size,
    );

    // Split ask order balance equally between inner and outer spread.
    let asset_balance_base = market_maker.balance_manager.balance<BaseAsset>();
    let ask_outer_quantity = compute_quantity(asset_balance_base / 2, lot_size, min_size);
    let ask_inner_quantity = compute_quantity(
        asset_balance_base - ask_outer_quantity,
        lot_size,
        min_size,
    );

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
public fun config(market_maker: &MarketMaker): &MarketMakerConfig {
    &market_maker.config
}

/// Returns the market maker capability object ID.
public fun cap_id(amm_cap: &MarketMakerCap): ID {
    amm_cap.id.to_inner()
}

// === Private Functions ===

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
    let expire_timestamp = clock.timestamp_ms() + ORDER_EXPIRATION_TIME_MS;
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

/// Helper function to convert pyth price into DeepBook price format, while checking for validity and freshness.
fun deepbook_price(
    price_info_object: &PriceInfoObject,
    config: &MarketMakerConfig,
    clock: &Clock,
): u64 {
    assert!(config.has_valid_pyth_feed_id(price_info_object), EPythFeedIdentifierMismatch);

    // Get pyth price object not older than `MAX_PRICE_AGE_SECS`.
    let price = pyth::get_price_no_older_than(
        price_info_object,
        clock,
        MAX_PRICE_AGE_SECS,
    );

    // Retrieve positive mantissa.
    let price_i64 = price.get_price();
    assert!(!price_i64.get_is_negative(), EPythPriceNonPositive);
    let mantissa_u128 = price_i64.get_magnitude_if_positive() as u128;
    assert!(mantissa_u128 != 0, EPythPriceNonPositive);

    // Retrieve negative exponent.
    let expo_i64 = price.get_expo();
    assert!(expo_i64.get_is_negative(), EPythExponentNonNegative);
    let exponent_u8 = expo_i64
        .get_magnitude_if_negative()
        .try_as_u8()
        .destroy_or!(abort EPythExponentTooLarge);
    assert!(exponent_u8 <= MAX_DECIMAL_POWER, EPythExponentTooLarge);

    // Compute deepbook price based on deepbook float scaling.
    // NOTE: mantissa (converted from u64) and float scaling multiplication
    // (can be represented in u64) should not overflow.
    let deepbook_price_u128 =
        mantissa_u128 * constants::float_scaling_u128() / 10u128.pow(exponent_u8);
    let deepbook_price = deepbook_price_u128.try_as_u64().destroy_or!(abort EPythInvalidPriceValue);

    assert!(deepbook_price >= constants::min_price(), EPythInvalidPriceValue);
    assert!(deepbook_price <= constants::max_price(), EPythInvalidPriceValue);

    deepbook_price
}

// === Test-Only Helpers ===

#[test_only]
/// Creates the package witness and runs init for tests.
public fun test_init(ctx: &mut TxContext) {
    let publisher_witness = sui::test_utils::create_one_time_witness<MARKET_MAKER>();
    init(
        publisher_witness,
        ctx,
    );
}
