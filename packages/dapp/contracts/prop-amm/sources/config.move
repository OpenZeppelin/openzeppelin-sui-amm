/// AMM configuration.
module openzeppelin_market_maker::config;

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
const EInvalidMaxConfRatioBps: vector<u8> =
    "max conf ratio bps must be greater than zero and at most 10000";
#[error(code = 4)]
const EInvalidOrderExpirationTime: vector<u8> = "order expiration time must be greater than zero";
#[error(code = 5)]
const EInvalidMaxPriceAge: vector<u8> = "max price age must be greater than zero";
#[error(code = 6)]
const EInvalidOuterBalanceBps: vector<u8> = "outer balance bps must be less than 10000";

// === Constants ===

const HUNDRED_PERCENT_BPS_U128: u128 = 10_000;
const HUNDRED_PERCENT_BPS: u64 = 10_000;

// === Structs ===

// TODO#q: add balance aware pricing configuration

/// AMM configuration for market maker executor.
public struct AMMConfig has drop, store {
    /// Base spread in basis points.
    base_spread_bps: u64,
    /// Volatility spread in basis points.
    volatility_spread_bps: u64,
    /// Duration in milliseconds after which a placed limit order expires.
    order_expiration_time_ms: u64,
    /// Maximum acceptable age in seconds for a Pyth price feed update.
    max_price_age_secs: u64,
    /// Maximum acceptable confidence-to-price ratio in basis points (e.g. 1000 = 10%).
    max_conf_ratio_bps: u64,
    /// Share of the settleable balance allocated to the outer (volatility) spread order, in
    /// basis points (e.g. 5000 = 50%); the inner (base) spread order receives the remainder.
    /// Valid range: `0..10_000` (exclusive upper bound). 0 disables the outer order
    /// entirely; values >= 10_000 would starve the inner order and are rejected.
    outer_balance_bps: u64,
}

// === Public Functions ===

/// Creates a new AMM configuration object.
///
/// Pass the returned value into `executor::create` when creating a new executor or into
/// `executor::update_config` when replacing an existing market maker executor configuration.
public fun new(
    base_spread_bps: u64,
    volatility_spread_bps: u64,
    order_expiration_time_ms: u64,
    max_price_age_secs: u64,
    max_conf_ratio_bps: u64,
    outer_balance_bps: u64,
): AMMConfig {
    assert!(base_spread_bps > 0, EInvalidBaseSpreadBps);
    assert!(base_spread_bps <= volatility_spread_bps, EBaseSpreadBpsExceedsVolatilitySpread);
    assert!(
        volatility_spread_bps <= HUNDRED_PERCENT_BPS,
        EVolatilitySpreadBpsExceedsMaxBasisPoints,
    );
    assert!(
        max_conf_ratio_bps > 0 && max_conf_ratio_bps <= HUNDRED_PERCENT_BPS,
        EInvalidMaxConfRatioBps,
    );
    assert!(order_expiration_time_ms > 0, EInvalidOrderExpirationTime);
    assert!(max_price_age_secs > 0, EInvalidMaxPriceAge);
    assert!(outer_balance_bps < HUNDRED_PERCENT_BPS, EInvalidOuterBalanceBps);

    AMMConfig {
        base_spread_bps,
        volatility_spread_bps,
        order_expiration_time_ms,
        max_price_age_secs,
        max_conf_ratio_bps,
        outer_balance_bps,
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

/// Returns the share of the settleable balance allocated to the outer (volatility) spread
/// order, in basis points (e.g. 5000 = 50%); the inner (base) spread order receives the
/// remainder. Valid range: `0..10_000` (exclusive upper bound). 0 disables the outer order
/// entirely; values >= 10_000 would starve the inner order and are rejected.
public fun outer_balance_bps(config: &AMMConfig): u64 {
    config.outer_balance_bps
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

/// Compute the amount of `balance` that should be allocated to the outer (volatility) spread
/// order; the caller spends the remainder on the inner (base) spread order.
public(package) fun outer_balance(config: &AMMConfig, balance: u64): u64 {
    ((balance as u128) * (config.outer_balance_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}
