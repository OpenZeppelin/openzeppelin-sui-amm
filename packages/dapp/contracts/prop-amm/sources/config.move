/// AMM configuration.
module openzeppelin_market_maker::config;

// === Errors ===

#[error(code = 0)]
const EInvalidBaseSpreadBps: vector<u8> =
    "base spread bps must be greater than zero and at most 10000";
#[error(code = 1)]
const EInvalidMaxConfRatioBps: vector<u8> =
    "max conf ratio bps must be greater than zero and at most 10000";
#[error(code = 2)]
const EInvalidOrderExpirationTime: vector<u8> = "order expiration time must be greater than zero";
#[error(code = 3)]
const EInvalidMaxPriceAge: vector<u8> = "max price age must be greater than zero";
#[error(code = 4)]
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
    /// Dynamic volatility buffer multiplier in basis points, applied on top of the base
    /// spread for the outer (volatility) order. Given the combined Pyth confidence ratio
    /// `conf_ratio_bps`, the outer order is placed at:
    /// `mid +- mid * (base_spread_bps + volatility_multiplier_bps * conf_ratio_bps / 10_000) / 10_000`.
    /// E.g: `0` disables the dynamic buffer (outer == inner); `10_000` applies 100% the
    /// confidence ratio; `20_000` applies 200%.
    volatility_multiplier_bps: u64,
    /// Duration in milliseconds after which a placed limit order expires.
    order_expiration_time_ms: u64,
    /// Maximum acceptable age in seconds for a Pyth price feed update.
    max_price_age_secs: u64,
    /// Maximum acceptable confidence-to-price ratio in basis points (e.g. 1000 = 10%).
    max_conf_ratio_bps: u64,
    /// Share of the settleable balance allocated to the outer (volatility) spread order, in
    /// basis points (e.g. 5000 = 50%).
    /// The inner (base) spread order receives the remainder. Valid range: [0..10_000) (exclusive upper bound).
    outer_balance_bps: u64,
}

// === Public Functions ===

/// Creates a new AMM configuration object.
///
/// Pass the returned value into `executor::create` when creating a new executor or into
/// `executor::update_config` when replacing an existing market maker executor configuration.
public fun new(
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    order_expiration_time_ms: u64,
    max_price_age_secs: u64,
    max_conf_ratio_bps: u64,
    outer_balance_bps: u64,
): AMMConfig {
    assert!(base_spread_bps > 0 && base_spread_bps <= HUNDRED_PERCENT_BPS, EInvalidBaseSpreadBps);
    assert!(
        max_conf_ratio_bps > 0 && max_conf_ratio_bps <= HUNDRED_PERCENT_BPS,
        EInvalidMaxConfRatioBps,
    );
    assert!(order_expiration_time_ms > 0, EInvalidOrderExpirationTime);
    assert!(max_price_age_secs > 0, EInvalidMaxPriceAge);
    assert!(outer_balance_bps < HUNDRED_PERCENT_BPS, EInvalidOuterBalanceBps);

    AMMConfig {
        base_spread_bps,
        volatility_multiplier_bps,
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

/// Dynamic volatility buffer multiplier in basis points, applied on top of the base
/// spread for the outer (volatility) order. Given the combined Pyth confidence ratio
/// `conf_ratio_bps`, the outer order is placed at:
/// `mid +- mid * (base_spread_bps + volatility_multiplier_bps * conf_ratio_bps / 10_000) / 10_000`.
/// E.g: `0` disables the dynamic buffer (outer == inner); `10_000` applies 100% the
/// confidence ratio; `20_000` applies 200%.
public fun volatility_multiplier_bps(config: &AMMConfig): u64 {
    config.volatility_multiplier_bps
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

/// Share of the settleable balance allocated to the outer (volatility) spread order, in
/// basis points (e.g. 5000 = 50%).
/// The inner (base) spread order receives the remainder. Valid range: [0..10_000) (exclusive upper bound).
public fun outer_balance_bps(config: &AMMConfig): u64 {
    config.outer_balance_bps
}

// === Package Functions ===

/// Compute the base spread in price terms for a given mid price.
public(package) fun base_spread(config: &AMMConfig, mid_price: u64): u64 {
    ((mid_price as u128) * (config.base_spread_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}

/// Compute the outer (volatility) spread in price terms for a given mid price and the
/// combined Pyth confidence ratio (in basis points). Equivalent to:
/// `mid * (base_spread_bps + volatility_multiplier_bps * conf_ratio_bps / 10_000) / 10_000`.
public(package) fun outer_spread(config: &AMMConfig, mid_price: u64, conf_ratio_bps: u64): u64 {
    let volatility_buffer_bps =
        (config.volatility_multiplier_bps as u128) * (conf_ratio_bps as u128)
            / HUNDRED_PERCENT_BPS_U128;
    let outer_spread_bps = (config.base_spread_bps as u128) + volatility_buffer_bps;
    ((mid_price as u128) * outer_spread_bps / HUNDRED_PERCENT_BPS_U128) as u64
}

/// Compute the amount of `balance` that should be allocated to the outer (volatility) spread
/// order; the caller spends the remainder on the inner (base) spread order.
public(package) fun outer_balance(config: &AMMConfig, balance: u64): u64 {
    ((balance as u128) * (config.outer_balance_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}
