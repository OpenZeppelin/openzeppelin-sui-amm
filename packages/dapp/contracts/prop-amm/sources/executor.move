/// Execution-time state and events for the AMM.
module openzeppelin_market_maker::executor;

use deepbook::balance_manager::{Self, BalanceManager, DepositCap, TradeCap, WithdrawCap};
use deepbook::registry::Registry;
use openzeppelin_market_maker::events;
use openzeppelin_market_maker::manager::AMMAdminCap;
use sui::coin::Coin;

// === Errors ===

#[error(code = 0)]
const ENotTraderAccountOwner: vector<u8> = b"sender must own the trader account";
#[error(code = 1)]
const EBalanceManagerMismatch: vector<u8> = b"balance manager must match the trader account";
#[error(code = 2)]
const EInvalidWithdrawAmount: vector<u8> = b"withdraw amount must be greater than zero";

// === Structs ===

/// Application witness for DeepBook registry authorization.
public struct PropAmmApp has drop {}

/// Per-trader account state.
public struct TraderAccount has key, store {
    /// Unique ID for the account object.
    id: UID,
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

// === Events ===

/// Emitted when a trader account is created.
public struct TraderAccountCreatedEvent has copy, drop {
    /// ID of the trader account object.
    trader_account_id: ID,
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
        balance_manager,
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
    let trader_account = create_trader_account(
        admin_cap,
        deepbook_registry,
        owner,
        ctx,
    );

    let trader_account_id = object::id(&trader_account);
    transfer::transfer(trader_account, owner);
    trader_account_id
}

/// Deposits funds into the trader account's linked balance manager.
public fun deposit<T>(
    trader_account: &mut TraderAccount,
    _: &AMMAdminCap,
    coin: Coin<T>,
    ctx: &TxContext,
) {
    trader_account
        .balance_manager
        .deposit_with_cap(
            &trader_account.caps.deposit_cap,
            coin,
            ctx,
        )
}

/// Registers the balance manager in the DeepBook registry.
public fun register_balance_manager(
    trader_account: &TraderAccount,
    _: &AMMAdminCap,
    registry: &mut Registry,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == trader_account.owner, ENotTraderAccountOwner);

    trader_account.balance_manager.register_balance_manager(registry, ctx);
}

/// Withdraws funds from the trader account's linked balance manager to the sender.
public fun withdraw_trader_account<T>(
    trader_account: &TraderAccount,
    balance_manager: &mut BalanceManager,
    withdraw_amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert_sender_can_manage_balance_manager(
        trader_account,
        balance_manager,
        ctx,
    );
    assert!(withdraw_amount > 0, EInvalidWithdrawAmount);

    balance_manager.withdraw<T>(
        withdraw_amount,
        ctx,
    )
}

// === Private Functions ===

/// Ensures the sender owns the trader account and provided the linked balance manager.
fun assert_sender_can_manage_balance_manager(
    trader_account: &TraderAccount,
    balance_manager: &BalanceManager,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == trader_account.owner, ENotTraderAccountOwner);
    assert!(trader_account.balance_manager.id() == balance_manager.id(), EBalanceManagerMismatch);
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
