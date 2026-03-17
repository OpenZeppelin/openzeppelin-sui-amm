/// Execution-time state for the AMM.
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
use deepbook::math;
use deepbook::order_info::OrderInfo;
use deepbook::pool::Pool;
use deepbook::registry::Registry;
use openzeppelin_market_maker::events;
use openzeppelin_market_maker::manager::{AMMConfig, AMMAdminCap};
use pyth::price_info::PriceInfoObject;
use pyth::pyth;
use sui::clock::Clock;
use sui::coin::Coin;

// === Errors ===

#[error(code = 0)]
const ENotTraderAccountOwner: vector<u8> = b"sender must own the trader account";
#[error(code = 1)]
const EBalanceManagerMismatch: vector<u8> = b"balance manager must match the trader account";
#[error(code = 2)]
const ETradingPaused: vector<u8> = b"trading is paused";
#[error(code = 3)]
const EInvalidPythPriceSign: vector<u8> = b"pyth price must be positive";
#[error(code = 4)]
const EInvalidPythPriceExponent: vector<u8> = b"pyth price exponent must be negative";
#[error(code = 5)]
const EInvalidPythPriceValue: vector<u8> = b"pyth price must be positive after scaling";
#[error(code = 6)]
const ESpreadTooWide: vector<u8> = b"effective spread must be below 10000 bps";
#[error(code = 7)]
const EInvalidSlippageBps: vector<u8> = b"slippage bps must be at most 10000";
#[error(code = 8)]
const EQuoteBalanceExceeded: vector<u8> =
    b"quote refresh exceeds available trader account balances";

// === Structs ===

/// Application witness for DeepBook registry authorization.
public struct PropAmmApp has drop {}

/// Per-trader account state.
///
/// Uses a table to map each pool ID to the trader's active order IDs.
public struct TraderAccount has key, store {
    /// Unique ID for the account object.
    id: UID,
    // TODO#q: this field is already stored inside BalanceManager (possible to reference balance manager to contract's owner and store the real one)
    /// Account owner.
    owner: address,
    /// Deepbook capabilities retained by the owner.
    caps: Caps,
    /// Balance manager linked to the trader account.
    balance_manager: BalanceManager,
}

/// Balance manager caps owned by the trader account owner.
public struct Caps has store {
    /// Deepbook's trade capability.
    trade_cap: TradeCap,
    /// Deepbook's deposit capability.
    deposit_cap: DepositCap,
    /// Deepbook's withdraw capability.
    withdraw_cap: WithdrawCap,
}

// === Public Functions ===

/// Creates a trader account.
public fun create_trader_account(
    _: &AMMAdminCap,
    deepbook_registry: &Registry,
    owner: address, // TODO#q: take owner address from the sender
    ctx: &mut TxContext,
): TraderAccount {
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
    ) = balance_manager::new_with_custom_owner_caps<PropAmmApp>(
        deepbook_registry,
        owner,
        ctx,
    );

    let caps = Caps {
        trade_cap,
        deposit_cap,
        withdraw_cap,
    };
    let trader_account = TraderAccount {
        id: object::new(ctx),
        owner,
        caps,
        balance_manager: balance_manager,
    };

    events::emit_trader_account_created(object::id(&trader_account));

    trader_account
}

/// Creates a trader account and transfers to owner.
public fun create_trader_account_and_transfer(
    admin_cap: &AMMAdminCap,
    deepbook_registry: &Registry,
    owner: address,
    ctx: &mut TxContext,
): ID {
    let trader_account = create_trader_account(admin_cap, deepbook_registry, owner, ctx);

    let trader_account_id = object::id(&trader_account);
    transfer::transfer(trader_account, owner);
    trader_account_id
}

/// Deposit funds into a balance manager.
public fun deposit<T>(
    trader_account: &mut TraderAccount,
    _: &AMMAdminCap,
    coin: Coin<T>,
    ctx: &TxContext,
) {
    trader_account.balance_manager.deposit_with_cap(&trader_account.caps.deposit_cap, coin, ctx)
}

/// Withdraw funds from a balance manager.
public fun withdraw<T>(
    trader_account: &mut TraderAccount,
    _: &AMMAdminCap,
    withdraw_amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    trader_account
        .balance_manager
        .withdraw_with_cap(&trader_account.caps.withdraw_cap, withdraw_amount, ctx)
}

/// Public quote refresh entrypoint for bot-driven PTBs.
///
/// Flow:
/// 1) Read latest cached oracle price from `price_info_object`.
/// 2) Cancel all stale orders for this account in the pool.
/// 3) Update balance based on all previously matched orders.
/// 4) Re-place four fresh orders (2 bids, 2 asks) around the oracle mid.
public fun refresh_quotes<BaseAsset, QuoteAsset>(
    trader_account: &mut TraderAccount,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    config: &AMMConfig,
    price_info_object: &PriceInfoObject,
    inner_quantity: u64,
    outer_quantity: u64,
    volatility_buffer_bps: u64,
    max_slippage_bps: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(!config.trading_paused(), ETradingPaused);
    assert!(max_slippage_bps <= 10_000, EInvalidSlippageBps);

    let oracle_mid_price = pyth_price_to_deepbook_price(price_info_object);
    let effective_spread_bps = config.base_spread_bps() + volatility_buffer_bps;
    assert!(effective_spread_bps < 10_000, ESpreadTooWide);

    let half_spread =
        ((oracle_mid_price as u128) * (effective_spread_bps as u128) / 10_000u128) as u64;
    let outer_half_spread = half_spread * 2;

    let bid_inner = bounded_bid_price(oracle_mid_price, half_spread);
    let ask_inner = bounded_ask_price(oracle_mid_price, half_spread);
    let bid_outer = bounded_bid_price(oracle_mid_price, outer_half_spread);
    let ask_outer = bounded_ask_price(oracle_mid_price, outer_half_spread);

    let max_bid_limit =
        (((oracle_mid_price as u128) * ((10_000 + max_slippage_bps) as u128)) / 10_000u128) as u64;
    let min_ask_limit =
        (((oracle_mid_price as u128) * ((10_000 - max_slippage_bps) as u128)) / 10_000u128) as u64;

    assert!(bid_inner <= max_bid_limit && bid_outer <= max_bid_limit, EInvalidSlippageBps);
    assert!(ask_inner >= min_ask_limit && ask_outer >= min_ask_limit, EInvalidSlippageBps);

    // Generate trade proof.
    let trade_proof = trader_account
        .balance_manager
        .generate_proof_as_trader(&trader_account.caps.trade_cap, ctx);

    // Cancel all previous active orders.
    pool.cancel_all_orders(
        &mut trader_account.balance_manager,
        &trade_proof,
        clock,
        ctx,
    );

    // Update balance manager balance, based on previous settled limit orders
    pool.withdraw_settled_amounts(&mut trader_account.balance_manager, &trade_proof);

    // TODO#q: put expiration time into config
    let expire_timestamp = clock.timestamp_ms() + 30_000;
    let order_type = constants::no_restriction();
    // TODO#q: remove self matching
    let self_matching_option = constants::self_matching_allowed();
    let pay_with_deep = true;

    // Place 4 limit orders (2 bids and 2 ask) based on current price and volatility parameters.
    trader_account.place_limit_order(
        pool,
        &trade_proof,
        1,
        order_type,
        self_matching_option,
        bid_outer,
        outer_quantity,
        true,
        pay_with_deep,
        expire_timestamp,
        clock,
        ctx,
    );
    trader_account.place_limit_order(
        pool,
        &trade_proof,
        2,
        order_type,
        self_matching_option,
        bid_inner,
        inner_quantity,
        true,
        pay_with_deep,
        expire_timestamp,
        clock,
        ctx,
    );
    trader_account.place_limit_order(
        pool,
        &trade_proof,
        3,
        order_type,
        self_matching_option,
        ask_inner,
        inner_quantity,
        false,
        pay_with_deep,
        expire_timestamp,
        clock,
        ctx,
    );
    trader_account.place_limit_order(
        pool,
        &trade_proof,
        4,
        order_type,
        self_matching_option,
        ask_outer,
        outer_quantity,
        false,
        pay_with_deep,
        expire_timestamp,
        clock,
        ctx,
    );

    events::emit_quote_updated(oracle_mid_price, effective_spread_bps);
}

// === Private Functions ===

fun place_limit_order<BaseAsset, QuoteAsset>(
    trader_account: &mut TraderAccount,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    trade_proof: &TradeProof,
    client_order_id: u64,
    order_type: u8,
    self_matching_option: u8,
    price: u64,
    quantity: u64,
    is_bid: bool,
    pay_with_deep: bool,
    expire_timestamp: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(
        pool.can_place_limit_order(
            &trader_account.balance_manager,
            price,
            quantity,
            is_bid,
            pay_with_deep,
            expire_timestamp,
            clock,
        ),
        EQuoteBalanceExceeded,
    );

    let order_info = pool.place_limit_order(
        &mut trader_account.balance_manager,
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

    if (order_info.executed_quantity() > 0) {
        let fill_price = math::div(
            order_info.cumulative_quote_quantity(),
            order_info.executed_quantity(),
        );
        events::emit_order_executed(order_info.order_id(), fill_price);
    };
}

fun pyth_price_to_deepbook_price(price_info_object: &PriceInfoObject): u64 {
    // TODO#q: use price with expiration?
    let pyth_price = pyth::get_price_unsafe(price_info_object);
    let pyth_price_i64 = pyth_price.get_price();
    assert!(!pyth_price_i64.get_is_negative(), EInvalidPythPriceSign);

    let pyth_expo_i64 = pyth_price.get_expo();
    assert!(pyth_expo_i64.get_is_negative(), EInvalidPythPriceExponent);

    let price_magnitude = pyth_price_i64.get_magnitude_if_positive() as u128;
    let decimals = pyth_expo_i64.get_magnitude_if_negative();

    // TODO#q: use oz math
    let scaled_price = if (decimals <= 9) {
        price_magnitude * 10u128.pow((9 - decimals) as u8)
    } else {
        price_magnitude / 10u128.pow((decimals - 9) as u8)
    };

    assert!(scaled_price > 0, EInvalidPythPriceValue);
    assert!(scaled_price <= constants::max_price() as u128, EInvalidPythPriceValue);

    scaled_price as u64
}

fun bounded_bid_price(mid_price: u64, spread: u64): u64 {
    if (spread >= mid_price) {
        constants::min_price()
    } else {
        mid_price - spread
    }
}

fun bounded_ask_price(mid_price: u64, spread: u64): u64 {
    let ask_price = (mid_price as u128) + (spread as u128);
    if (ask_price > constants::max_price() as u128) {
        constants::max_price()
    } else {
        ask_price as u64
    }
}

// === View helpers ===

/// Returns the trader account owner.
public fun owner(trader_account: &TraderAccount): address {
    trader_account.owner
}

/// Returns the trader account object ID.
public fun trader_account_id(trader_account: &TraderAccount): ID {
    trader_account.id.to_inner()
}

/// Returns the balance manager.
public fun balance_manager(trader_account: &TraderAccount): &BalanceManager {
    &trader_account.balance_manager
}

/// Returns a deepbook's trade cap ID.
public fun trade_cap_id(trader_account: &TraderAccount): ID {
    object::id(&trader_account.caps.trade_cap)
}

/// Returns a deepbook's deposit cap ID.
public fun deposit_cap_id(trader_account: &TraderAccount): ID {
    object::id(&trader_account.caps.deposit_cap)
}

/// Returns a deepbook's withdraw cap ID.
public fun withdraw_cap_id(trader_account: &TraderAccount): ID {
    object::id(&trader_account.caps.withdraw_cap)
}
