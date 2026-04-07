/// AMM configuration.
module openzeppelin_market_maker::config;

use deepbook::pool::Pool;
use pyth::price_info::PriceInfoObject;

// === Errors ===

#[error(code = 0)]
const EInvalidBaseSpreadBps: vector<u8> = "base spread bps must be greater than zero";
#[error(code = 1)]
const EBaseSpreadBpsExceedsVolatilitySpread: vector<u8> =
    "base spread should not exceed a volatility spread";
#[error(code = 2)]
const EVolatilitySpreadBpsExceedsMaxBasisPoints: vector<u8> =
    "volatility spread bps must be at most 10000";
#[error(code = 3)]
const EInvalidPythPriceFeedIdLength: vector<u8> = "pyth price feed id must be 32 bytes";

// === Constants ===

const HUNDRED_PERCENT_BPS_U128: u128 = 10_000;
const HUNDRED_PERCENT_BPS: u64 = 10_000;
const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;

// === Structs ===

/// AMM configuration shared across pools.
public struct MarketMakerConfig has drop, store {
    /// Whether trading is active.
    active: bool,
    /// Base spread in basis points.
    base_spread_bps: u64,
    /// Volatility spread in basis points.
    volatility_spread_bps: u64,
    /// Pyth price feed identifier bytes.
    pyth_price_feed_id: vector<u8>,
    /// Whether LASER pricing is enabled.
    use_laser: bool,
    /// ID of the associated pool.
    pool_id: ID,
}

// === Public Functions ===

/// Creates a new AMM configuration object with validated inputs.
///
/// Pass the returned value into `market_maker::create` when
/// creating a new market maker or into `market_maker::update_market_maker`
/// when replacing an existing market maker configuration.
public fun create<BaseAsset, QuoteAsset>(
    pool: &Pool<BaseAsset, QuoteAsset>,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
): MarketMakerConfig {
    assert_valid_amm_config_inputs!(base_spread_bps, volatility_spread_bps, pyth_price_feed_id);

    MarketMakerConfig {
        base_spread_bps,
        volatility_spread_bps,
        use_laser,
        active: true,
        pyth_price_feed_id,
        pool_id: object::id(pool),
    }
}

// === View Functions ===

/// Returns the base spread in basis points.
public fun base_spread_bps(config: &MarketMakerConfig): u64 {
    config.base_spread_bps
}

/// Returns the volatility spread in basis points.
public fun volatility_spread_bps(config: &MarketMakerConfig): u64 {
    config.volatility_spread_bps
}

/// Returns whether LASER pricing is enabled.
public fun use_laser(config: &MarketMakerConfig): bool {
    config.use_laser
}

/// Returns whether trading is paused.
public fun active(config: &MarketMakerConfig): bool {
    config.active
}

/// Returns the Pyth price feed ID bytes.
public fun pyth_price_feed_id(config: &MarketMakerConfig): vector<u8> {
    config.pyth_price_feed_id
}

/// Checks whether the price info object contains a valid Pyth price feed ID matching the config.
public fun has_valid_pyth_feed_id(
    config: &MarketMakerConfig,
    price_info_object: &PriceInfoObject,
): bool {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    let actual_price_feed_id = price_info.get_price_identifier().get_bytes();
    actual_price_feed_id == config.pyth_price_feed_id
}

/// Returns the associated pool's object ID.
public fun pool_id(config: &MarketMakerConfig): ID {
    config.pool_id
}

/// Checks whether the given pool matches the config's associated pool ID.
public fun has_valid_pool<BaseAsset, QuoteAsset>(
    config: &MarketMakerConfig,
    pool: &Pool<BaseAsset, QuoteAsset>,
): bool {
    config.pool_id == object::id(pool)
}

// === Package Functions ===

/// Compute the base spread in price terms for a given mid price.
public(package) fun base_spread(config: &MarketMakerConfig, mid_price: u64): u64 {
    ((mid_price as u128) * (config.base_spread_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}

/// Compute the volatility spread in price terms for a given mid price.
public(package) fun volatility_spread(config: &MarketMakerConfig, mid_price: u64): u64 {
    ((mid_price as u128) * (config.volatility_spread_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}

/// Returns the required Pyth price feed identifier length.
public(package) fun pyth_price_identifier_length(): u64 {
    PYTH_PRICE_IDENTIFIER_LENGTH
}

/// Pauses trading by setting `active` to false.
public(package) fun pause(config: &mut MarketMakerConfig) {
    // TODO#q: emit trading paused.
    config.active = false
}

/// Activate trading by setting `active` to true.
public(package) fun unpause(config: &mut MarketMakerConfig) {
    config.active = true
}

// === Private Functions ===

/// Validates all inputs for a new or updated configuration.
macro fun assert_valid_amm_config_inputs(
    $base_spread_bps: u64,
    $volatility_spread_bps: u64,
    $pyth_price_feed_id: vector<u8>,
) {
    let base_spread_bps = $base_spread_bps;
    let volatility_spread_bps = $volatility_spread_bps;
    let pyth_price_feed_id = $pyth_price_feed_id;
    assert!(base_spread_bps > 0, EInvalidBaseSpreadBps);
    assert!(base_spread_bps <= volatility_spread_bps, EBaseSpreadBpsExceedsVolatilitySpread);
    assert!(
        volatility_spread_bps <= HUNDRED_PERCENT_BPS,
        EVolatilitySpreadBpsExceedsMaxBasisPoints,
    );
    assert!(
        pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );
}
