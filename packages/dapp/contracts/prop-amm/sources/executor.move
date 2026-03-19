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
use deepbook::pool::Pool;
use deepbook::registry::Registry;
use openzeppelin_market_maker::events;
use openzeppelin_market_maker::manager::{AMMConfig, AMMAdminCap};
use pyth::price_info::PriceInfoObject;
use pyth::pyth;
use sui::clock::Clock;
use sui::coin::Coin;

// === Constants ===

const ORDER_EXPIRATION_TIME_MS: u64 = 30_000;

// === Errors ===

#[error(code = 0)]
const ETradingPaused: vector<u8> = b"trading is paused";
#[error(code = 1)]
const EInvalidPythPriceSign: vector<u8> = b"pyth price must be positive";
#[error(code = 2)]
const EInvalidPythPriceExponent: vector<u8> = b"pyth price exponent must be negative";
#[error(code = 3)]
const EInvalidPythPriceValue: vector<u8> = b"pyth price must be positive after scaling";

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
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(!config.trading_paused(), ETradingPaused);

    // Calculate base and volatility spread values.
    let oracle_mid_price = pyth_price_to_deepbook_price(price_info_object);
    let base_spread = config.base_spread(oracle_mid_price);
    let volatility_spread = config.volatility_spread(oracle_mid_price);

    // Calculate bids/ask order prices.
    let bid_inner = oracle_mid_price
        .checked_sub(base_spread)
        .destroy_or!(constants::min_price())
        .max(constants::min_price());
    let bid_outer = oracle_mid_price
        .checked_sub(volatility_spread)
        .destroy_or!(constants::min_price())
        .max(constants::min_price());
    let ask_inner = oracle_mid_price
        .checked_add(base_spread)
        .destroy_or!(constants::max_price())
        .min(constants::max_price());
    let ask_outer = oracle_mid_price
        .checked_add(volatility_spread)
        .destroy_or!(constants::max_price())
        .min(constants::max_price());

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

    // Update balance manager, to reflect previous settled limit orders in balance.
    pool.withdraw_settled_amounts(&mut trader_account.balance_manager, &trade_proof);

    // Split bid order balance equally between inner and outer spread.
    let base_asset_balance = trader_account.balance_manager.balance<BaseAsset>();
    let bid_outer_quantity = base_asset_balance / 2;
    let bid_inner_quantity = base_asset_balance - bid_outer_quantity;

    // Split ask order balance equally between inner and outer spread.
    let quote_asset_balance = trader_account.balance_manager.balance<QuoteAsset>();
    let ask_outer_quantity = quote_asset_balance / 2;
    let ask_inner_quantity = quote_asset_balance - ask_outer_quantity;

    // Self matching should not happen (if happens due to logic error abort taker order).
    let self_matching_option = constants::cancel_taker();
    let expire_timestamp = clock.timestamp_ms() + ORDER_EXPIRATION_TIME_MS;
    let order_type = constants::no_restriction();
    let pay_with_deep = true;

    // Place 4 limit orders (2 bids and 2 ask) based on current price and volatility parameters.
    trader_account.try_place_limit_order(
        pool,
        &trade_proof,
        1,
        order_type,
        self_matching_option,
        bid_outer,
        bid_outer_quantity,
        true,
        pay_with_deep,
        expire_timestamp,
        clock,
        ctx,
    );
    trader_account.try_place_limit_order(
        pool,
        &trade_proof,
        2,
        order_type,
        self_matching_option,
        bid_inner,
        bid_inner_quantity,
        true,
        pay_with_deep,
        expire_timestamp,
        clock,
        ctx,
    );
    trader_account.try_place_limit_order(
        pool,
        &trade_proof,
        3,
        order_type,
        self_matching_option,
        ask_inner,
        ask_inner_quantity,
        false,
        pay_with_deep,
        expire_timestamp,
        clock,
        ctx,
    );
    trader_account.try_place_limit_order(
        pool,
        &trade_proof,
        4,
        order_type,
        self_matching_option,
        ask_outer,
        ask_outer_quantity,
        false,
        pay_with_deep,
        expire_timestamp,
        clock,
        ctx,
    );

    events::emit_quote_updated(
        oracle_mid_price,
        config.base_spread_bps(),
        config.volatility_spread_bps(),
    );
}

// === Private Functions ===

fun try_place_limit_order<BaseAsset, QuoteAsset>(
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
    // Don't place an order if quantity is zero.
    if (quantity == 0){
        return
    };
    
    // Place a limit order
    pool.place_limit_order(
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
