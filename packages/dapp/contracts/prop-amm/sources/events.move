/// Events for the AMM.
module openzeppelin_market_maker::events;

use std::type_name::TypeName;
use sui::event;

// === Events ===

/// Emitted when a market maker executor is created.
public struct ExecutorCreated has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
    /// ID of the admin capability object for this executor.
    admin_cap_id: ID,
}

/// Emitted whenever quote levels are recomputed from oracle input.
/// Spreads, confidence ratio, and post-settlement balances live on the `Info` storage struct
/// of the executor and should be read from there at the time the event is observed.
public struct QuoteUpdated has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
    /// Mid price used for quote generation (DeepBook fixed-point format).
    price: u64,
    /// Orders placed during this refresh.
    orders: vector<LimitOrder>,
}

/// Snapshot of a single limit order placed during a quote refresh.
public struct LimitOrder has copy, drop {
    /// DeepBook-assigned order id.
    order_id: u128,
    /// Price (DeepBook fixed-point format).
    price: u64,
    /// Quantity in base asset terms (lot-size aligned).
    quantity: u64,
    /// `true` for bids, `false` for asks.
    is_bid: bool,
}

/// Emitted when market maker executor trading is paused.
public struct ExecutorPaused has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
}

/// Emitted when market maker executor trading is unpaused.
public struct ExecutorUnpaused has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
}

/// Emitted when the market maker executor configuration is updated.
public struct ExecutorConfigUpdated has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
}

/// Emitted when funds are deposited into the market maker executor.
public struct Deposited has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
    /// Type of the deposited coin.
    coin_type: TypeName,
    /// Amount deposited.
    amount: u64,
}

/// Emitted when funds are withdrawn from the market maker executor.
public struct Withdrawn has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
    /// Type of the withdrawn coin.
    coin_type: TypeName,
    /// Amount withdrawn.
    amount: u64,
}

// === Package Functions ===

/// Construct a `LimitOrder` payload.
public(package) fun new_order(order_id: u128, price: u64, quantity: u64, is_bid: bool): LimitOrder {
    LimitOrder { order_id, price, quantity, is_bid }
}

/// Emit an `ExecutorCreated` event.
public(package) fun emit_executor_created(executor_id: ID, admin_cap_id: ID) {
    event::emit(ExecutorCreated { executor_id, admin_cap_id });
}

/// Emit a `QuoteUpdated` event.
public(package) fun emit_quote_updated(executor_id: ID, price: u64, orders: vector<LimitOrder>) {
    event::emit(QuoteUpdated { executor_id, price, orders });
}

/// Emit an `ExecutorPaused` event.
public(package) fun emit_executor_paused(executor_id: ID) {
    event::emit(ExecutorPaused { executor_id });
}

/// Emit an `ExecutorUnpaused` event.
public(package) fun emit_executor_unpaused(executor_id: ID) {
    event::emit(ExecutorUnpaused { executor_id });
}

/// Emit an `ExecutorConfigUpdated` event.
public(package) fun emit_executor_config_updated(executor_id: ID) {
    event::emit(ExecutorConfigUpdated { executor_id });
}

/// Emit a `Deposited` event.
public(package) fun emit_deposited(executor_id: ID, coin_type: TypeName, amount: u64) {
    event::emit(Deposited { executor_id, coin_type, amount });
}

/// Emit a `Withdrawn` event.
public(package) fun emit_withdrawn(executor_id: ID, coin_type: TypeName, amount: u64) {
    event::emit(Withdrawn { executor_id, coin_type, amount });
}

// === Test-Only Helpers ===

/// Builds an `ExecutorCreated` payload.
#[test_only]
public(package) fun executor_created(executor_id: ID, admin_cap_id: ID): ExecutorCreated {
    ExecutorCreated { executor_id, admin_cap_id }
}

/// Builds an `ExecutorPaused` payload.
#[test_only]
public(package) fun executor_paused(executor_id: ID): ExecutorPaused {
    ExecutorPaused { executor_id }
}

/// Builds an `ExecutorUnpaused` payload.
#[test_only]
public(package) fun executor_unpaused(executor_id: ID): ExecutorUnpaused {
    ExecutorUnpaused { executor_id }
}

/// Builds an `ExecutorConfigUpdated` payload.
#[test_only]
public(package) fun executor_config_updated(executor_id: ID): ExecutorConfigUpdated {
    ExecutorConfigUpdated { executor_id }
}

/// Builds a `Deposited` payload.
#[test_only]
public(package) fun deposited(executor_id: ID, coin_type: TypeName, amount: u64): Deposited {
    Deposited { executor_id, coin_type, amount }
}

/// Builds a `Withdrawn` payload.
#[test_only]
public(package) fun withdrawn(executor_id: ID, coin_type: TypeName, amount: u64): Withdrawn {
    Withdrawn { executor_id, coin_type, amount }
}
