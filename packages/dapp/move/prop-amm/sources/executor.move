/// Execution-time state and events for the AMM.
module amm::executor;

use amm::manager;
use deepbook::balance_manager::{Self, BalanceManager, DepositCap, TradeCap, WithdrawCap};
use deepbook::registry::Registry;
use sui::table::{Self, Table};

// === Imports ===

// === Errors ===

const ENotTraderAccountOwner: u64 = 1;
const EBalanceManagerMismatch: u64 = 2;

// === Structs ===

/// Application witness for DeepBook registry authorization.
public struct PropAmmApp has drop {}

/// Balance manager cap IDs owned by the trader account owner.
public struct CapIds has copy, drop, store {
    /// Trade capability ID.
    trade_cap_id: Option<ID>,
    /// Deposit capability ID.
    deposit_cap_id: Option<ID>,
    /// Withdraw capability ID.
    withdraw_cap_id: Option<ID>,
}

/// Per-trader account state.
///
/// Uses a table to map each pool ID to the trader's active order IDs.
public struct TraderAccount has key, store {
    /// Unique ID for the account object.
    id: UID,
    /// Account owner.
    owner: address,
    /// Balance manager ID for DeepBook trading.
    balance_manager_id: ID,
    /// Capability IDs retained by the owner.
    cap_ids: CapIds,
    /// Active order IDs keyed by pool ID (table entries are stored on-chain).
    active_orders: Table<ID, vector<ID>>,
}

// === Events ===

/// Emitted when a trader account is created.
public struct TraderAccountCreatedEvent has copy, drop {
    /// Trader account identifier.
    trader_account_id: address,
    /// Owner address.
    owner: address,
    /// Balance manager identifier.
    balance_manager_id: ID,
    /// Trade capability ID.
    trade_cap_id: Option<ID>,
    /// Deposit capability ID.
    deposit_cap_id: Option<ID>,
    /// Withdraw capability ID.
    withdraw_cap_id: Option<ID>,
}

/// Emitted when a quote is updated.
public struct QuoteUpdatedEvent has copy, drop {
    /// Pool identifier.
    pool_id: ID,
    /// Quote price.
    price: u64,
    /// Spread in basis points.
    spread_bps: u64,
    /// Quote timestamp in milliseconds.
    timestamp_ms: u64,
}

/// Emitted when an order is executed.
public struct OrderExecutedEvent has copy, drop {
    /// Order identifier.
    order_id: ID,
    /// Execution price.
    fill_price: u64,
}

// === Public Functions ===

/// Registers the balance manager in the DeepBook registry.
///
/// Only the trader account owner can call this entry.
entry fun register_balance_manager(
    trader_account: &TraderAccount,
    balance_manager: &BalanceManager,
    registry: &mut Registry,
    ctx: &mut TxContext,
) {
    assert_trader_account_owner(trader_account, ctx);
    assert_balance_manager_matches_account(trader_account, balance_manager);

    balance_manager::register_balance_manager(balance_manager, registry, ctx);
}

/// Creates a balance manager with caps and a trader account, returning the objects for PTB composition.
///
/// Intended for callers that want to compose transfers/sharing in a larger PTB.
/// Requires `PropAmmApp` to be authorized in the DeepBook registry.
public fun create_trader_account_components(
    deepbook_registry: &Registry,
    owner: address,
    ctx: &mut TxContext,
): (BalanceManager, DepositCap, WithdrawCap, TradeCap, TraderAccount, CapIds) {
    let (balance_manager, deposit_cap, withdraw_cap, trade_cap) = create_balance_manager_with_caps(
        deepbook_registry,
        owner,
        ctx,
    );

    let (trader_account, cap_ids) = build_trader_account_with_cap_ids(
        &balance_manager,
        &trade_cap,
        &deposit_cap,
        &withdraw_cap,
        owner,
        ctx,
    );

    (balance_manager, deposit_cap, withdraw_cap, trade_cap, trader_account, cap_ids)
}

/// Creates a balance manager with caps and a trader account, transferring caps/account to the owner
/// and sharing the balance manager.
///
/// Intended for the standard "one-step" flow (no custom PTB composition).
/// Requires `PropAmmApp` to be authorized in the DeepBook registry.
entry fun create_trader_account_with_shared_manager_and_owner_caps(
    deepbook_registry: &Registry,
    admin_cap: &manager::AMMAdminCap,
    owner: address,
    ctx: &mut TxContext,
) {
    manager::assert_admin_cap(admin_cap);

    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
        cap_ids,
    ) = create_trader_account_components(deepbook_registry, owner, ctx);

    let balance_manager_id = balance_manager::id(&balance_manager);
    let trader_account_id = trader_account.id.to_address();

    transfer::public_transfer(deposit_cap, owner);
    transfer::public_transfer(withdraw_cap, owner);
    transfer::public_transfer(trade_cap, owner);
    transfer::public_transfer(trader_account, owner);
    transfer::public_share_object(balance_manager);

    emit_trader_account_created(
        trader_account_id,
        owner,
        balance_manager_id,
        &cap_ids,
    );
}

// === Internal Helpers ===

/// Ensures the transaction sender owns the trader account.
fun assert_trader_account_owner(trader_account: &TraderAccount, ctx: &TxContext) {
    assert!(ctx.sender() == trader_account.owner, ENotTraderAccountOwner);
}

/// Ensures the balance manager matches the trader account.
fun assert_balance_manager_matches_account(
    trader_account: &TraderAccount,
    balance_manager: &BalanceManager,
) {
    assert!(
        trader_account.balance_manager_id == balance_manager::id(balance_manager),
        EBalanceManagerMismatch,
    );
}

/// Creates a balance manager and mints caps for the owner.
fun create_balance_manager_with_caps(
    deepbook_registry: &Registry,
    owner: address,
    ctx: &mut TxContext,
): (BalanceManager, DepositCap, WithdrawCap, TradeCap) {
    balance_manager::new_with_custom_owner_caps<PropAmmApp>(
        deepbook_registry,
        owner,
        ctx,
    )
}

/// Builds a trader account and the associated cap ID metadata.
fun build_trader_account_with_cap_ids(
    balance_manager: &BalanceManager,
    trade_cap: &TradeCap,
    deposit_cap: &DepositCap,
    withdraw_cap: &WithdrawCap,
    owner: address,
    ctx: &mut TxContext,
): (TraderAccount, CapIds) {
    let cap_ids = build_cap_ids(trade_cap, deposit_cap, withdraw_cap);
    let trader_account = build_trader_account(
        owner,
        balance_manager::id(balance_manager),
        copy cap_ids,
        ctx,
    );

    (trader_account, cap_ids)
}

/// Captures the cap IDs for storage in the trader account.
fun build_cap_ids(
    trade_cap: &TradeCap,
    deposit_cap: &DepositCap,
    withdraw_cap: &WithdrawCap,
): CapIds {
    CapIds {
        trade_cap_id: option::some(object::id(trade_cap)),
        deposit_cap_id: option::some(object::id(deposit_cap)),
        withdraw_cap_id: option::some(object::id(withdraw_cap)),
    }
}

/// Constructs a trader account with empty active orders.
fun build_trader_account(
    owner: address,
    balance_manager_id: ID,
    cap_ids: CapIds,
    ctx: &mut TxContext,
): TraderAccount {
    TraderAccount {
        id: object::new(ctx),
        owner,
        balance_manager_id,
        cap_ids,
        active_orders: table::new(ctx),
    }
}

/// Emits the trader account created event.
fun emit_trader_account_created(
    trader_account_id: address,
    owner: address,
    balance_manager_id: ID,
    cap_ids: &CapIds,
) {
    sui::event::emit(TraderAccountCreatedEvent {
        trader_account_id,
        owner,
        balance_manager_id,
        trade_cap_id: cap_ids.trade_cap_id,
        deposit_cap_id: cap_ids.deposit_cap_id,
        withdraw_cap_id: cap_ids.withdraw_cap_id,
    });
}

/// Emits a quote updated event for the given pool.
public(package) fun emit_quote_updated(
    pool_id: ID,
    price: u64,
    spread_bps: u64,
    timestamp_ms: u64,
) {
    sui::event::emit(QuoteUpdatedEvent {
        pool_id,
        price,
        spread_bps,
        timestamp_ms,
    });
}

/// Emits an order executed event.
public(package) fun emit_order_executed(order_id: ID, fill_price: u64) {
    sui::event::emit(OrderExecutedEvent { order_id, fill_price });
}

// === Test-Only Helpers ===

#[test_only]
/// Returns the trader account owner for tests.
public fun owner(trader_account: &TraderAccount): address {
    trader_account.owner
}

#[test_only]
/// Returns the balance manager ID for tests.
public fun balance_manager_id(trader_account: &TraderAccount): ID {
    trader_account.balance_manager_id
}

#[test_only]
/// Returns the trade cap ID for tests.
public fun trade_cap_id(trader_account: &TraderAccount): Option<ID> {
    trader_account.cap_ids.trade_cap_id
}

#[test_only]
/// Returns the deposit cap ID for tests.
public fun deposit_cap_id(trader_account: &TraderAccount): Option<ID> {
    trader_account.cap_ids.deposit_cap_id
}

#[test_only]
/// Returns the withdraw cap ID for tests.
public fun withdraw_cap_id(trader_account: &TraderAccount): Option<ID> {
    trader_account.cap_ids.withdraw_cap_id
}
