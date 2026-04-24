/// Events for the AMM.
module openzeppelin_market_maker::events;

use std::type_name::TypeName;
use sui::event;

// === Events ===

/// Emitted when a market maker executor is created.
public struct ExecutorCreated has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
}

/// Emitted whenever quote levels are recomputed from oracle input.
public struct QuoteUpdated has copy, drop {
    /// ID of the market maker executor object.
    executor_id: ID,
    /// Mid price used for quote generation (DeepBook fixed-point format).
    price: u64,
    /// Effective spread in bps used for this update.
    base_spread_bps: u64,
    /// Volatility multiplier in bps used for this update.
    volatility_multiplier_bps: u64,
    /// Combined Pyth confidence ratio (base/base + quote/quote) in bps observed for this
    /// update; drives the dynamic volatility buffer on top of `base_spread_bps`.
    conf_ratio_bps: u64,
    /// Cumulative base-asset volume within the current DeepBook epoch at the time of refresh.
    volume_base: u128,
    /// Quote-asset balance in the balance manager after settlement, before new orders are placed.
    quote_balance: u64,
    /// Base-asset balance in the balance manager after settlement, before new orders are placed.
    base_balance: u64,
    /// Order ID of the outer (wider-spread) bid placed in this refresh, or `None` if skipped.
    bid_outer_order_id: Option<u128>,
    /// Order ID of the inner bid placed in this refresh, or `None` if skipped.
    bid_inner_order_id: Option<u128>,
    /// Order ID of the inner ask placed in this refresh, or `None` if skipped.
    ask_inner_order_id: Option<u128>,
    /// Order ID of the outer (wider-spread) ask placed in this refresh, or `None` if skipped.
    ask_outer_order_id: Option<u128>,
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

/// Emitted when the market maker executor's market metadata is updated.
public struct MarketUpdated has copy, drop {
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

/// Emit an `ExecutorCreated` event.
public(package) fun emit_executor_created(executor_id: ID) {
    event::emit(ExecutorCreated { executor_id });
}

/// Emit a `QuoteUpdated` event.
public(package) fun emit_quote_updated(
    executor_id: ID,
    price: u64,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    conf_ratio_bps: u64,
    volume_base: u128,
    quote_balance: u64,
    base_balance: u64,
    bid_outer_order_id: Option<u128>,
    bid_inner_order_id: Option<u128>,
    ask_inner_order_id: Option<u128>,
    ask_outer_order_id: Option<u128>,
) {
    event::emit(QuoteUpdated {
        executor_id,
        price,
        base_spread_bps,
        volatility_multiplier_bps,
        conf_ratio_bps,
        volume_base,
        quote_balance,
        base_balance,
        bid_outer_order_id,
        bid_inner_order_id,
        ask_inner_order_id,
        ask_outer_order_id,
    });
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

/// Emit a `MarketUpdated` event.
public(package) fun emit_market_updated(executor_id: ID) {
    event::emit(MarketUpdated { executor_id });
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
public(package) fun executor_created(executor_id: ID): ExecutorCreated {
    ExecutorCreated { executor_id }
}

/// Builds a `QuoteUpdated` payload.
#[test_only]
public(package) fun quote_updated(
    executor_id: ID,
    price: u64,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    conf_ratio_bps: u64,
    volume_base: u128,
    quote_balance: u64,
    base_balance: u64,
    bid_outer_order_id: Option<u128>,
    bid_inner_order_id: Option<u128>,
    ask_inner_order_id: Option<u128>,
    ask_outer_order_id: Option<u128>,
): QuoteUpdated {
    QuoteUpdated {
        executor_id,
        price,
        base_spread_bps,
        volatility_multiplier_bps,
        conf_ratio_bps,
        volume_base,
        quote_balance,
        base_balance,
        bid_outer_order_id,
        bid_inner_order_id,
        ask_inner_order_id,
        ask_outer_order_id,
    }
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

/// Builds a `MarketUpdated` payload.
#[test_only]
public(package) fun market_updated(executor_id: ID): MarketUpdated {
    MarketUpdated { executor_id }
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
