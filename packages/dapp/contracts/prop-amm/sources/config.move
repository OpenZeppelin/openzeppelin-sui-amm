/// AMM configuration.
module openzeppelin_market_maker::config;

// TODO#q: rename module to amm_config (or config/amm)

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
#[error(code = 4)]
const EInvalidMaxConfRatioBps: vector<u8> =
    "max conf ratio bps must be greater than zero and at most 10000";
#[error(code = 5)]
const EInvalidOrderExpirationTime: vector<u8> = "order expiration time must be greater than zero";
#[error(code = 6)]
const EInvalidMaxPriceAge: vector<u8> = "max price age must be greater than zero";

// === Constants ===

const HUNDRED_PERCENT_BPS_U128: u128 = 10_000;
const HUNDRED_PERCENT_BPS: u64 = 10_000;
const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;

// === Structs ===

// TODO#q: extract market configuration fields to `market` module (base_pyth_price_feed_id, quote_pyth_price_feed_id, pool_id, base_price_publish_time, quote_price_publish_time, )
// TODO#q: move `active` flag to Executor
// TODO#q: add balance aware pricing configuration

/// AMM configuration shared across pools.
public struct AMMConfig has drop, store {
    /// Whether trading is active.
    active: bool,
    /// Base spread in basis points.
    base_spread_bps: u64,
    /// Volatility spread in basis points.
    volatility_spread_bps: u64,
    /// Pyth price feed identifier bytes for the base asset.
    base_pyth_price_feed_id: vector<u8>,
    /// Pyth price feed identifier bytes for the quote asset.
    quote_pyth_price_feed_id: vector<u8>,
    /// ID of the associated pool.
    pool_id: ID,
    /// Latest observed base asset publish timestamp.
    base_price_publish_time: Option<u64>,
    /// Latest observed quote asset publish timestamp.
    quote_price_publish_time: Option<u64>,
    /// Duration in milliseconds after which a placed limit order expires.
    order_expiration_time_ms: u64,
    /// Maximum acceptable age in seconds for a Pyth price feed update.
    max_price_age_secs: u64,
    /// Maximum acceptable confidence-to-price ratio in basis points (e.g. 1000 = 10%).
    max_conf_ratio_bps: u64,
}

// === Public Functions ===

/// Creates a new AMM configuration object from a pool ID.
/// Useful for PTBs that cannot pass pool objects with generic type arguments.
///
/// Pass the returned value into `executor::create` when
/// creating a new executor or into `executor::update_market_maker`
/// when replacing an existing market maker configuration.
public fun new(
    pool_id: ID,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
    base_pyth_price_feed_id: vector<u8>,
    quote_pyth_price_feed_id: vector<u8>,
    order_expiration_time_ms: u64,
    max_price_age_secs: u64,
    max_conf_ratio_bps: u64,
): AMMConfig {
    assert!(base_spread_bps > 0, EInvalidBaseSpreadBps);
    assert!(base_spread_bps <= volatility_spread_bps, EBaseSpreadBpsExceedsVolatilitySpread);
    assert!(
        volatility_spread_bps <= HUNDRED_PERCENT_BPS,
        EVolatilitySpreadBpsExceedsMaxBasisPoints,
    );
    assert!(
        base_pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );
    assert!(
        quote_pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );
    assert!(
        max_conf_ratio_bps > 0 && max_conf_ratio_bps <= HUNDRED_PERCENT_BPS,
        EInvalidMaxConfRatioBps,
    );
    assert!(order_expiration_time_ms > 0, EInvalidOrderExpirationTime);
    assert!(max_price_age_secs > 0, EInvalidMaxPriceAge);

    AMMConfig {
        base_spread_bps,
        volatility_spread_bps,
        active: true,
        base_pyth_price_feed_id,
        quote_pyth_price_feed_id,
        pool_id,
        base_price_publish_time: option::none(),
        quote_price_publish_time: option::none(),
        order_expiration_time_ms,
        max_price_age_secs,
        max_conf_ratio_bps,
    }
}

// === View helpers ===

/// Returns the base spread in basis points.
public fun base_spread_bps(config: &AMMConfig): u64 {
    config.base_spread_bps
}

/// Returns the volatility spread in basis points.
public fun volatility_spread_bps(config: &AMMConfig): u64 {
    config.volatility_spread_bps
}

/// Returns whether trading is paused.
public fun active(config: &AMMConfig): bool {
    config.active
}

/// Returns the Pyth base asset price feed ID bytes.
public fun base_pyth_price_feed_id(config: &AMMConfig): vector<u8> {
    config.base_pyth_price_feed_id
}

/// Returns the Pyth quote asset price feed ID bytes.
public fun quote_pyth_price_feed_id(config: &AMMConfig): vector<u8> {
    config.quote_pyth_price_feed_id
}

/// Checks whether the price info object contains a valid Pyth base asset price feed ID matching the config.
public fun has_valid_base_pyth_feed_id(
    config: &AMMConfig,
    price_info_object: &PriceInfoObject,
): bool {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    let actual_price_feed_id = price_info.get_price_identifier().get_bytes();
    actual_price_feed_id == config.base_pyth_price_feed_id
}

/// Checks whether the price info object contains a valid Pyth quote asset price feed ID matching the config.
public fun has_valid_quote_pyth_feed_id(
    config: &AMMConfig,
    price_info_object: &PriceInfoObject,
): bool {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    let actual_price_feed_id = price_info.get_price_identifier().get_bytes();
    actual_price_feed_id == config.quote_pyth_price_feed_id
}

/// Returns the associated pool's object ID.
public fun pool_id(config: &AMMConfig): ID {
    config.pool_id
}

/// Checks whether the given pool matches the config's associated pool ID.
public fun has_valid_pool<BaseAsset, QuoteAsset>(
    config: &AMMConfig,
    pool: &Pool<BaseAsset, QuoteAsset>,
): bool {
    config.pool_id == object::id(pool)
}

/// Returns the latest base price publish time in seconds, if any.
public fun base_price_publish_time(config: &AMMConfig): Option<u64> {
    config.base_price_publish_time
}

/// Returns the latest quote price publish time in seconds, if any.
public fun quote_price_publish_time(config: &AMMConfig): Option<u64> {
    config.quote_price_publish_time
}

/// Returns the order expiration duration in milliseconds.
public fun order_expiration_time_ms(config: &AMMConfig): u64 {
    config.order_expiration_time_ms
}

/// Returns the maximum acceptable Pyth price age in seconds.
public fun max_price_age_secs(config: &AMMConfig): u64 {
    config.max_price_age_secs
}

/// Returns the maximum acceptable confidence-to-price ratio in basis points.
public fun max_conf_ratio_bps(config: &AMMConfig): u64 {
    config.max_conf_ratio_bps
}

// === Package Functions ===

/// Compute the base spread in price terms for a given mid price.
public(package) fun base_spread(config: &AMMConfig, mid_price: u64): u64 {
    ((mid_price as u128) * (config.base_spread_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}

/// Compute the volatility spread in price terms for a given mid price.
public(package) fun volatility_spread(config: &AMMConfig, mid_price: u64): u64 {
    ((mid_price as u128) * (config.volatility_spread_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}

/// Returns the required Pyth price feed identifier length.
public(package) fun pyth_price_identifier_length(): u64 {
    PYTH_PRICE_IDENTIFIER_LENGTH
}

/// Pauses trading by setting `active` to false.
public(package) fun pause(config: &mut AMMConfig) {
    config.active = false
}

/// Activate trading by setting `active` to true.
public(package) fun unpause(config: &mut AMMConfig) {
    config.active = true
}

/// Sets new base `publish_time` and returns the latest base price publish time in seconds, if any.
public(package) fun set_base_price_publish_time(
    config: &mut AMMConfig,
    publish_time: u64,
): Option<u64> {
    config.base_price_publish_time.swap_or_fill(publish_time)
}

/// Sets new quote `publish_time` and returns the latest quote price publish time in seconds, if any.
public(package) fun set_quote_price_publish_time(
    config: &mut AMMConfig,
    publish_time: u64,
): Option<u64> {
    config.quote_price_publish_time.swap_or_fill(publish_time)
}
