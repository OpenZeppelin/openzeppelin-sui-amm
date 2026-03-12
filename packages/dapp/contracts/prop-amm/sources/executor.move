/// Execution-time state and events for the AMM.
module openzeppelin_market_maker::executor;

use deepbook::balance_manager::{Self, BalanceManager, DepositCap, TradeCap, WithdrawCap};
use deepbook::registry::Registry;
use sui::table::{Self, Table};

// === Errors ===

#[error]
const ENotTraderAccountOwner: vector<u8> = b"sender must own the trader account";
#[error]
const EBalanceManagerMismatch: vector<u8> = b"balance manager must match the trader account";

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

// === Public Functions ===

/// Registers the balance manager in the DeepBook registry.
public fun register_balance_manager(
    trader_account: &TraderAccount,
    balance_manager: &BalanceManager,
    registry: &mut Registry,
    ctx: &mut TxContext,
) {
    assert_trader_account_owner(trader_account, ctx);
    assert_balance_manager_matches_account(trader_account, balance_manager);

    balance_manager::register_balance_manager(balance_manager, registry, ctx);
}

// === Private Functions ===

/// Creates a balance manager with caps and a trader account, returning the objects for PTB composition.
///
/// This is the low-level constructor flow for custom PTB composition.
/// It returns the created objects without transferring the caps, trader account, or sharing the balance manager.
/// Requires `PropAmmApp` to be authorized in the DeepBook registry.
public(package) fun create_trader_account_components(
    deepbook_registry: &Registry,
    owner: address,
    ctx: &mut TxContext,
): (BalanceManager, DepositCap, WithdrawCap, TradeCap, TraderAccount, CapIds) {
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

    let (trader_account, cap_ids) = create_trader_account_with_cap_ids(
        &balance_manager,
        &trade_cap,
        &deposit_cap,
        &withdraw_cap,
        owner,
        ctx,
    );

    (balance_manager, deposit_cap, withdraw_cap, trade_cap, trader_account, cap_ids)
}

/// Creates a trader account with empty active orders.
public(package) fun create_trader_account(
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

/// Creates a trader account and the associated cap ID metadata.
fun create_trader_account_with_cap_ids(
    balance_manager: &BalanceManager,
    trade_cap: &TradeCap,
    deposit_cap: &DepositCap,
    withdraw_cap: &WithdrawCap,
    owner: address,
    ctx: &mut TxContext,
): (TraderAccount, CapIds) {
    let cap_ids = create_cap_ids(trade_cap, deposit_cap, withdraw_cap);
    let trader_account = create_trader_account(
        owner,
        balance_manager::id(balance_manager),
        copy cap_ids,
        ctx,
    );

    (trader_account, cap_ids)
}

/// Captures the cap IDs for storage in the trader account.
fun create_cap_ids(
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

// === View helpers ===

/// Returns the trader account owner.
public fun owner(trader_account: &TraderAccount): address {
    trader_account.owner
}

/// Returns the trader account object ID.
public fun trader_account_id(trader_account: &TraderAccount): ID {
    trader_account.id.to_inner()
}

/// Returns the balance manager ID.
public fun balance_manager_id(trader_account: &TraderAccount): ID {
    trader_account.balance_manager_id
}

/// Returns all capability IDs retained by the owner.
public fun cap_ids(trader_account: &TraderAccount): CapIds {
    trader_account.cap_ids
}

/// Returns the active orders table keyed by pool ID.
public fun active_orders(trader_account: &TraderAccount): &Table<ID, vector<ID>> {
    &trader_account.active_orders
}

/// Returns the trade cap ID.
public fun trade_cap_id(trader_account: &TraderAccount): Option<ID> {
    trader_account.cap_ids.trade_cap_id
}

/// Returns the deposit cap ID.
public fun deposit_cap_id(trader_account: &TraderAccount): Option<ID> {
    trader_account.cap_ids.deposit_cap_id
}

/// Returns the withdraw cap ID.
public fun withdraw_cap_id(trader_account: &TraderAccount): Option<ID> {
    trader_account.cap_ids.withdraw_cap_id
}
