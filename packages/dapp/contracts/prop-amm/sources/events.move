/// Events for the AMM.
module openzeppelin_market_maker::events;

use sui::event;

/// Emitted when a market maker is created.
public struct MarketMakerCreated has copy, drop {
    /// ID of the market maker object.
    market_maker_id: ID,
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

/// Emitted when market maker trading is paused.
public struct MarketMakerPaused has copy, drop {
    /// ID of the market maker object.
    market_maker_id: ID,
}

/// Emitted when market maker trading is unpaused.
public struct MarketMakerUnpaused has copy, drop {
    /// ID of the market maker object.
    market_maker_id: ID,
}

/// Emitted when market maker configuration is updated.
/// 
/// NOTE: Can be emitted when update triggered even without actual changes to config.
public struct MarketMakerConfigUpdated has copy, drop {
    /// ID of the market maker object.
    market_maker_id: ID,
}

/// Emit a `MarketMakerCreated` event.
public(package) fun emit_market_maker_created(market_maker_id: ID) {
    event::emit(MarketMakerCreated { market_maker_id });
}

/// Emit a `QuoteUpdated` event.
public(package) fun emit_quote_updated(
    price: u64,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
) {
    event::emit(QuoteUpdated { price, base_spread_bps, volatility_spread_bps });
}

/// Emit a `MarketMakerPaused` event.
public(package) fun emit_market_maker_paused(market_maker_id: ID) {
    event::emit(MarketMakerPaused { market_maker_id });
}

/// Emit a `MarketMakerUnpaused` event.
public(package) fun emit_market_maker_unpaused(market_maker_id: ID) {
    event::emit(MarketMakerUnpaused { market_maker_id });
}

/// Emit a `MarketMakerConfigUpdated` event.
public(package) fun emit_market_maker_config_updated(market_maker_id: ID) {
    event::emit(MarketMakerConfigUpdated { market_maker_id });
}

// === Test only helpers ===

/// Builds a `MarketMakerCreated` payload.
#[test_only]
public(package) fun market_maker_created(market_maker_id: ID): MarketMakerCreated {
    MarketMakerCreated { market_maker_id }
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

/// Builds a `MarketMakerPaused` payload.
#[test_only]
public(package) fun market_maker_paused(market_maker_id: ID): MarketMakerPaused {
    MarketMakerPaused { market_maker_id }
}

/// Builds a `MarketMakerUnpaused` payload.
#[test_only]
public(package) fun market_maker_unpaused(market_maker_id: ID): MarketMakerUnpaused {
    MarketMakerUnpaused { market_maker_id }
}

/// Builds a `MarketMakerConfigUpdated` payload.
#[test_only]
public(package) fun market_maker_config_updated(market_maker_id: ID): MarketMakerConfigUpdated {
    MarketMakerConfigUpdated { market_maker_id }
}
