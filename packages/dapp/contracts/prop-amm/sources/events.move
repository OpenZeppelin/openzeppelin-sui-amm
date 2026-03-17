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
