/// AMM configuration.
module openzeppelin_market_maker::config;

use deepbook::constants;

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
#[error(code = 5)]
const EInvalidInventorySkewBps: vector<u8> = "inventory skew bps must be less than 10000";
#[error(code = 6)]
const EPriceUnderflow: vector<u8> = "price lower than minimum or underflowed";
#[error(code = 7)]
const EPriceOverflow: vector<u8> = "price higher than maximum or oveflowed";

// === Constants ===

const HUNDRED_PERCENT_BPS_U128: u128 = 10_000;
const HUNDRED_PERCENT_BPS: u64 = 10_000;

// === Structs ===

/// AMM configuration for market maker executor.
public struct AMMConfig has drop, store {
    /// Duration in milliseconds after which a placed limit order expires.
    order_expiration_time_ms: u64,
    /// Maximum acceptable age in seconds for a Pyth price feed update.
    max_price_age_secs: u64,
    /// Base spread in basis points (0..10_000).
    base_spread_bps: u64,
    /// Maximum acceptable confidence-to-price ratio in basis points (0..10_000).
    /// E.g: 1000 = 10%.
    max_conf_ratio_bps: u64,
    /// Dynamic volatility buffer multiplier in basis points [0..), applied on top of the base
    /// spread for the outer (volatility) order. Given the combined Pyth confidence ratio
    /// `conf_ratio_bps`, the outer order is placed at:
    /// `mid +- mid * (base_spread_bps + volatility_multiplier_bps * conf_ratio_bps / 10_000) / 10_000`.
    /// E.g:
    ///     `0` disables the dynamic buffer (outer == inner).
    ///     `10_000` applies 100% the confidence ratio.
    ///     `20_000` applies 200%.
    volatility_multiplier_bps: u64,
    /// Share of the settleable balance in basis points [0..10_000) allocated to the outer (volatility)
    /// spread order; the inner (base) spread order receives the remainder. Given a settled
    /// `balance` on one side, the outer order size is computed as:
    /// `outer_balance = balance * outer_balance_bps / 10_000`.
    /// E.g:
    ///     `0` disables the outer order (inner receives the full balance).
    ///     `5_000` splits the balance 50/50; values >= `10_000` are rejected.
    outer_balance_bps: u64,
    /// Inventory-driven mid-shift coefficient in basis points [0..10_000), expressed as a fraction of
    /// `base_spread` to apply at fully one-sided inventory. Given the settled `base_value`
    /// and `quote_value` (both valued at the oracle mid, in quote units), the reservation
    /// mid is computed as:
    /// `reservation_mid = mid - base_spread * inventory_skew_bps * (base_value - quote_value) / (base_value + quote_value) / 10_000`.
    /// E.g:
    ///     `0` disables skewing (reservation_mid == mid).
    ///     `5_000` shifts the mid by half the `base_spread` at fully one-sided inventory.
    inventory_skew_bps: u64,
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
    inventory_skew_bps: u64,
): AMMConfig {
    assert!(base_spread_bps > 0 && base_spread_bps < HUNDRED_PERCENT_BPS, EInvalidBaseSpreadBps);
    assert!(
        max_conf_ratio_bps > 0 && max_conf_ratio_bps < HUNDRED_PERCENT_BPS,
        EInvalidMaxConfRatioBps,
    );
    assert!(outer_balance_bps < HUNDRED_PERCENT_BPS, EInvalidOuterBalanceBps);
    assert!(inventory_skew_bps < HUNDRED_PERCENT_BPS, EInvalidInventorySkewBps);
    assert!(order_expiration_time_ms > 0, EInvalidOrderExpirationTime);
    assert!(max_price_age_secs > 0, EInvalidMaxPriceAge);

    AMMConfig {
        base_spread_bps,
        volatility_multiplier_bps,
        order_expiration_time_ms,
        max_price_age_secs,
        max_conf_ratio_bps,
        outer_balance_bps,
        inventory_skew_bps,
    }
}

// === View helpers ===

/// Returns the order expiration duration in milliseconds.
public fun order_expiration_time_ms(config: &AMMConfig): u64 {
    config.order_expiration_time_ms
}

/// Returns the maximum acceptable Pyth price age in seconds.
public fun max_price_age_secs(config: &AMMConfig): u64 {
    config.max_price_age_secs
}

/// Returns the base spread in basis points (0..10_000).
public fun base_spread_bps(config: &AMMConfig): u64 {
    config.base_spread_bps
}

/// Maximum acceptable confidence-to-price ratio in basis points (0..10_000).
/// E.g: 1000 = 10%.
public fun max_conf_ratio_bps(config: &AMMConfig): u64 {
    config.max_conf_ratio_bps
}

/// Dynamic volatility buffer multiplier in basis points [0..), applied on top of the base
/// spread for the outer (volatility) order. Given the combined Pyth confidence ratio
/// `conf_ratio_bps`, the outer order is placed at:
/// `mid +- mid * (base_spread_bps + volatility_multiplier_bps * conf_ratio_bps / 10_000) / 10_000`.
/// E.g:
///     `0` disables the dynamic buffer (outer == inner).
///     `10_000` applies 100% the confidence ratio.
///     `20_000` applies 200%.
public fun volatility_multiplier_bps(config: &AMMConfig): u64 {
    config.volatility_multiplier_bps
}

/// Share of the settleable balance in basis points [0..10_000) allocated to the outer (volatility)
/// spread order; the inner (base) spread order receives the remainder. Given a settled
/// `balance` on one side, the outer order size is computed as:
/// `outer_balance = balance * outer_balance_bps / 10_000`.
/// E.g:
///     `0` disables the outer order (inner receives the full balance).
///     `5_000` splits the balance 50/50; values >= `10_000` are rejected.
public fun outer_balance_bps(config: &AMMConfig): u64 {
    config.outer_balance_bps
}

/// Inventory-driven mid-shift coefficient in basis points [0..10_000), expressed as a fraction of
/// `base_spread` to apply at fully one-sided inventory. Given the settled `base_value`
/// and `quote_value` (both valued at the oracle mid, in quote units), the reservation
/// mid is computed as:
/// `reservation_mid = mid - base_spread * inventory_skew_bps * (base_value - quote_value) / (base_value + quote_value) / 10_000`.
/// E.g:
///     `0` disables skewing (reservation_mid == mid).
///     `5_000` shifts the mid by half the `base_spread` at fully one-sided inventory.
public fun inventory_skew_bps(config: &AMMConfig): u64 {
    config.inventory_skew_bps
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

/// Compute the amount of `balance` that should be allocated to the outer (volatility) spread order.
public(package) fun outer_balance(config: &AMMConfig, balance: u64): u64 {
    ((balance as u128) * (config.outer_balance_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}

/// Compute the reservation mid: the oracle `mid_price` shifted by up to `base_spread`
/// toward the side that rebalances the book, scaled by `inventory_skew_bps` (fraction of
/// `base_spread` to apply at fully one-sided inventory).
/// The computed shift is always bounded by `base_spread`, so the inner order on the
/// rebalancing side never lands beyond the oracle mid.
/// Returns `mid_price` unchanged when `inventory_skew_bps == 0` or when total inventory is zero.
public(package) fun reservation_mid(
    config: &AMMConfig,
    mid_price: u64,
    base_balance: u64,
    quote_balance: u64,
): u64 {
    // If skew param is zero return return mid price unchanged.
    if (config.inventory_skew_bps == 0) {
        return mid_price
    };

    // Value both sides in quote-asset terms and if total amount zero return mid price unchanged.
    let base_balance_in_quote =
        (base_balance as u128) * (mid_price as u128) / constants::float_scaling_u128();
    let quote_balance = quote_balance as u128;
    let total_balance = base_balance_in_quote + quote_balance;
    if (total_balance == 0) {
        return mid_price
    };

    // Calculate shift.
    let base_spread = config.base_spread(mid_price) as u128;
    let skew_bps = config.inventory_skew_bps as u128;
    let imbalance = base_balance_in_quote.diff(quote_balance);
    let shift = base_spread.checked_mul(imbalance).destroy_or!(abort EPriceOverflow) / total_balance;
    let adjusted_shift = shift * skew_bps / HUNDRED_PERCENT_BPS_U128;

    // Apply shift to the mid_price.
    let reservation_mid = if (base_balance_in_quote >= quote_balance) {
        // adjusted_shift < base_spread < mid_price
        mid_price - (adjusted_shift as u64)
    } else {
        mid_price.checked_add(adjusted_shift as u64).destroy_or!(abort EPriceOverflow)
    };
    assert!(reservation_mid >= constants::min_price(), EPriceUnderflow);
    assert!(reservation_mid <= constants::max_price(), EPriceOverflow);

    reservation_mid
}
