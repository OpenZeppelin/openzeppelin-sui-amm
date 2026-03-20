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
    base_spread_bps: u64,
    /// Volatility spread in bps used for this update.
    volatility_spread_bps: u64,
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

/// Emit an `AMMConfigUpdated` event.
public(package) fun emit_amm_config_updated(config_id: ID) {
    event::emit(AMMConfigUpdated { config_id });
}

/// Builds an `AMMConfigUpdated` payload.
#[test_only]
public(package) fun amm_config_updated(config_id: ID): AMMConfigUpdated {
    AMMConfigUpdated { config_id }
}

/// Emit a `TraderAccountCreated` event.
public(package) fun emit_trader_account_created(trader_account_id: ID) {
    event::emit(TraderAccountCreated { trader_account_id });
}

/// Builds a `TraderAccountCreated` payload.
#[test_only]
public(package) fun trader_account_created(trader_account_id: ID): TraderAccountCreated {
    TraderAccountCreated { trader_account_id }
}

/// Emit a `QuoteUpdated` event.
public(package) fun emit_quote_updated(
    price: u64,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
) {
    event::emit(QuoteUpdated { price, base_spread_bps, volatility_spread_bps });
}

/// Builds a `QuoteUpdated` payload.
#[test_only]
public(package) fun quote_updated(
    price: u64,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
): QuoteUpdated {
    QuoteUpdated { price, base_spread_bps, volatility_spread_bps }
}
