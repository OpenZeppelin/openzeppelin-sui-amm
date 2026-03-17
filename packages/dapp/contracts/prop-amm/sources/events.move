/// Events for the AMM.
module openzeppelin_market_maker::events;

use sui::event;

/// Emitted when a new configuration object is created.
public struct AMMConfigCreated has copy, drop {
    /// ID of the configuration object.
    config_id: ID,
}

/// Emitted when a configuration object is updated.
public struct AMMConfigUpdated has copy, drop {
    /// ID of the configuration object.
    config_id: ID,
}

/// Emitted when a trader account is created.
public struct TraderAccountCreated has copy, drop {
    /// ID of the trader account object.
    trader_account_id: ID,
}

/// Emitted whenever quote levels are recomputed from oracle input.
public struct QuoteUpdated has copy, drop {
    /// Mid price used for quote generation (DeepBook fixed-point format).
    price: u64,
    /// Effective spread in bps used for this update.
    spread: u64,
}

/// Emitted when an order placement immediately executes against resting liquidity.
public struct OrderExecuted has copy, drop {
    /// DeepBook order identifier.
    order_id: u128,
    /// Fill price reported in DeepBook fixed-point format.
    fill_price: u64,
}

/// Emit an `AMMConfigCreated` event.
public(package) fun emit_amm_config_created(config_id: ID) {
    event::emit(AMMConfigCreated { config_id });
}

/// Builds an `AMMConfigCreated` payload.
#[test_only]
public(package) fun amm_config_created(config_id: ID): AMMConfigCreated {
    AMMConfigCreated { config_id }
}

/// Emit an `AMMConfigCreated` event.
public(package) fun emit_amm_config_updated(config_id: ID) {
    event::emit(AMMConfigUpdated { config_id });
}

/// Builds an `AMMConfigCreated` payload.
#[test_only]
public(package) fun amm_config_updated(config_id: ID): AMMConfigUpdated {
    AMMConfigUpdated { config_id }
}

/// Emit an  `TraderAccountCreated` event.
public(package) fun emit_trader_account_created(trader_account_id: ID) {
    event::emit(TraderAccountCreated { trader_account_id });
}

/// Builds an `TraderAccountCreated` payload.
#[test_only]
public(package) fun trader_account_created(trader_account_id: ID): TraderAccountCreated {
    TraderAccountCreated { trader_account_id }
}

/// Emit a `QuoteUpdated` event.
public(package) fun emit_quote_updated(price: u64, spread: u64) {
    event::emit(QuoteUpdated { price, spread });
}

/// Builds a `QuoteUpdated` payload.
#[test_only]
public(package) fun quote_updated(price: u64, spread: u64): QuoteUpdated {
    QuoteUpdated { price, spread }
}

/// Emit an `OrderExecuted` event.
public(package) fun emit_order_executed(order_id: u128, fill_price: u64) {
    event::emit(OrderExecuted { order_id, fill_price });
}

/// Builds an `OrderExecuted` payload.
#[test_only]
public(package) fun order_executed(order_id: u128, fill_price: u64): OrderExecuted {
    OrderExecuted { order_id, fill_price }
}
