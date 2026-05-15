/// AMM configuration.
module openzeppelin_market_maker::config;

use deepbook::constants;

// === Errors ===

#[error(code = 0)]
const EInvalidBaseSpreadBps: vector<u8> =
    "base spread bps must be greater than zero and less than 10000";
#[error(code = 1)]
const EInvalidMaxConfRatioBps: vector<u8> =
    "max conf ratio bps must be greater than zero and less than 10000";
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
const EPriceOverflow: vector<u8> = "price higher than maximum or overflowed";
#[error(code = 8)]
const EInvalidStalePriceToleranceBps: vector<u8> =
    "stale price tolerance bps must be less than 10000";

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
    /// Permissionless-refresh skip threshold in basis points [0..10_000), expressed as a
    /// fraction of `base_spread`. A `refresh_quotes_permissionless` call is skipped when the
    /// executor has open orders AND the worst-case order drift is below this fraction of
    /// `base_spread`:
    ///   `mid_drift_bps + conf_drift_bps < base_spread_bps * stale_price_tolerance_bps / 10_000`
    /// where `mid_drift_bps = |d(mid)| / last_mid * 10_000` (affects every order) and
    ///       `conf_drift_bps = volatility_multiplier_bps * |d(conf)| / 10_000
    ///                         * (outer_balance_bps * 2 / 10_000)` (outer orders only, balance-weighted;
    ///                         `1.0` at the 50/50 split, `0` when `outer_balance_bps == 0`).
    /// Bounding the threshold by `base_spread` ensures a skipped refresh can never hide a
    /// shift that would move an order across the inner placement distance.
    /// Mitigates FIFO-priority grief on DeepBook where any address can force a cancel-and-replace
    /// on every Pyth tick. The admin `refresh_quotes` bypasses this guard.
    /// E.g (assuming `base_spread_bps = 100` and `outer_balance_bps = 5_000` — the 50/50 split):
    ///     `0` disables the guard (every Pyth tick triggers a refresh; original behavior).
    ///     `5_000` tolerates 50 bps of price drift (50% of `base_spread`) when `conf_ratio_bps`
    ///             is unchanged.
    stale_price_tolerance_bps: u64,
    /// Restricts every refresh-quotes order to the passive (post-only) book side.
    /// `true` places each order with DeepBook's `post_only` flag: any order that would
    /// cross the resting book aborts the whole `refresh_quotes` transaction, leaving the
    /// previous quotes in place until the next oracle reading.
    /// `false` places each order with `no_restriction`: the crossing portion executes
    /// immediately as a taker (and the remainder rests). Use only when taker fills against
    /// adversarial liquidity placed inside the anticipated quote are acceptable.
    post_only: bool,
}

// === Public Functions ===

/// Creates a new AMM configuration.
///
/// Pass the returned value into `executor::create` when creating a new executor or into
/// `executor::update_config` when replacing an existing market maker executor configuration.
/// `post_only` is a safety parameter that should be set to `true` unless crossing the book with the quotes and taking market orders is an acceptable risk.
public fun new(
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    order_expiration_time_ms: u64,
    max_price_age_secs: u64,
    max_conf_ratio_bps: u64,
    outer_balance_bps: u64,
    inventory_skew_bps: u64,
    stale_price_tolerance_bps: u64,
    post_only: bool,
): AMMConfig {
    assert!(base_spread_bps > 0 && base_spread_bps < HUNDRED_PERCENT_BPS, EInvalidBaseSpreadBps);
    assert!(
        max_conf_ratio_bps > 0 && max_conf_ratio_bps < HUNDRED_PERCENT_BPS,
        EInvalidMaxConfRatioBps,
    );
    assert!(outer_balance_bps < HUNDRED_PERCENT_BPS, EInvalidOuterBalanceBps);
    assert!(inventory_skew_bps < HUNDRED_PERCENT_BPS, EInvalidInventorySkewBps);
    assert!(stale_price_tolerance_bps < HUNDRED_PERCENT_BPS, EInvalidStalePriceToleranceBps);
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
        stale_price_tolerance_bps,
        post_only,
    }
}

// === View helpers ===

/// Returns the order expiration duration in milliseconds.
public fun order_expiration_time_ms(self: &AMMConfig): u64 {
    self.order_expiration_time_ms
}

/// Returns the maximum acceptable Pyth price age in seconds.
public fun max_price_age_secs(self: &AMMConfig): u64 {
    self.max_price_age_secs
}

/// Returns the base spread in basis points (0..10_000).
public fun base_spread_bps(self: &AMMConfig): u64 {
    self.base_spread_bps
}

/// Maximum acceptable confidence-to-price ratio in basis points (0..10_000).
/// E.g: 1000 = 10%.
public fun max_conf_ratio_bps(self: &AMMConfig): u64 {
    self.max_conf_ratio_bps
}

/// Dynamic volatility buffer multiplier in basis points [0..), applied on top of the base
/// spread for the outer (volatility) order. Given the combined Pyth confidence ratio
/// `conf_ratio_bps`, the outer order is placed at:
/// `mid +- mid * (base_spread_bps + volatility_multiplier_bps * conf_ratio_bps / 10_000) / 10_000`.
/// E.g:
///     `0` disables the dynamic buffer (outer == inner).
///     `10_000` applies 100% the confidence ratio.
///     `20_000` applies 200%.
public fun volatility_multiplier_bps(self: &AMMConfig): u64 {
    self.volatility_multiplier_bps
}

/// Share of the settleable balance in basis points [0..10_000) allocated to the outer (volatility)
/// spread order; the inner (base) spread order receives the remainder. Given a settled
/// `balance` on one side, the outer order size is computed as:
/// `outer_balance = balance * outer_balance_bps / 10_000`.
/// E.g:
///     `0` disables the outer order (inner receives the full balance).
///     `5_000` splits the balance 50/50; values >= `10_000` are rejected.
public fun outer_balance_bps(self: &AMMConfig): u64 {
    self.outer_balance_bps
}

/// Inventory-driven mid-shift coefficient in basis points [0..10_000), expressed as a fraction of
/// `base_spread` to apply at fully one-sided inventory. Given the settled `base_value`
/// and `quote_value` (both valued at the oracle mid, in quote units), the reservation
/// mid is computed as:
/// `reservation_mid = mid - base_spread * inventory_skew_bps * (base_value - quote_value) / (base_value + quote_value) / 10_000`.
/// E.g:
///     `0` disables skewing (reservation_mid == mid).
///     `5_000` shifts the mid by half the `base_spread` at fully one-sided inventory.
public fun inventory_skew_bps(self: &AMMConfig): u64 {
    self.inventory_skew_bps
}

/// Permissionless-refresh skip threshold in basis points [0..10_000), expressed as a
/// fraction of `base_spread`. A `refresh_quotes_permissionless` call is skipped when the
/// executor has open orders AND the worst-case order drift is below this fraction of
/// `base_spread`:
///   `mid_drift_bps + conf_drift_bps < base_spread_bps * stale_price_tolerance_bps / 10_000`
/// where `mid_drift_bps = |d(mid)| / last_mid * 10_000` (affects every order) and
///       `conf_drift_bps = volatility_multiplier_bps * |d(conf)| / 10_000
///                         * (outer_balance_bps * 2 / 10_000)` (outer orders only, balance-weighted;
///                         `1.0` at the 50/50 split, `0` when `outer_balance_bps == 0`).
/// Bounding the threshold by `base_spread` ensures a skipped refresh can never hide a
/// shift that would move an order across the inner placement distance.
/// Mitigates FIFO-priority grief on DeepBook where any address can force a cancel-and-replace
/// on every Pyth tick. The admin `refresh_quotes` bypasses this guard.
/// E.g (assuming `base_spread_bps = 100` and `outer_balance_bps = 5_000` — the 50/50 split):
///     `0` disables the guard (every Pyth tick triggers a refresh; original behavior).
///     `5_000` tolerates 50 bps of price drift (50% of `base_spread`) when `conf_ratio_bps`
///             is unchanged.
public fun stale_price_tolerance_bps(self: &AMMConfig): u64 {
    self.stale_price_tolerance_bps
}

/// Returns whether `refresh_quotes` should place orders as post-only.
/// `true` aborts the whole refresh if any order would cross the resting book, preserving
/// the previous quotes. `false` allows the crossing portion to execute as a taker.
public fun post_only(self: &AMMConfig): bool {
    self.post_only
}

// === Package Functions ===

/// Compute the base spread in price terms for a given mid price.
public(package) fun base_spread(self: &AMMConfig, mid_price: u64): u64 {
    mid_price.mul_div(self.base_spread_bps, HUNDRED_PERCENT_BPS)
}

/// Compute the outer (volatility) spread in price terms for a given mid price and the
/// combined Pyth confidence ratio (in basis points). Equivalent to:
/// `mid * (base_spread_bps + volatility_multiplier_bps * conf_ratio_bps / 10_000) / 10_000`.
public(package) fun outer_spread(self: &AMMConfig, mid_price: u64, conf_ratio_bps: u64): u64 {
    // Compute volatility bps.
    let conf_based_volatility_bps = self
        .volatility_multiplier_bps
        .mul_div(conf_ratio_bps, HUNDRED_PERCENT_BPS);

    // Compute total volatility(outer) spread bps.
    let outer_spread_bps = self.base_spread_bps + conf_based_volatility_bps;

    // Calculate total volatility spread.
    mid_price.mul_div(outer_spread_bps, HUNDRED_PERCENT_BPS)
}

/// Compute the amount of `balance` that should be allocated to the outer (volatility) spread order.
public(package) fun outer_balance(self: &AMMConfig, balance: u64): u64 {
    balance.mul_div(self.outer_balance_bps, HUNDRED_PERCENT_BPS)
}

/// Returns `true` when the worst-case ladder drift (in bps of price) between the resting
/// ladder and the new ladder is below `base_spread_bps * stale_price_tolerance_bps / 10_000`
/// (`stale_price_tolerance_bps` interpreted as a fraction of `base_spread`).
/// When this returns `true`, the permissionless refresh path skips the cancel-and-replace
/// cycle to preserve FIFO priority.
///
/// The worst-case order drift sums the two independent contributions, both in bps of price:
/// - `mid_drift_bps  = |new_mid - last_mid| / last_mid * 10_000`         (affects every order)
/// - `conf_drift_bps = volatility_multiplier_bps * |new_conf - last_conf| / 10_000
///                    * (outer_balance_bps * 2 / 10_000)`                (outer orders only,
///                                                                       balance-weighted)
///
/// Outer-order drift `mid_drift_bps + conf_drift_bps` dominates inner-order drift
/// `mid_drift_bps` (conf_drift is non-negative), so checking the outer alone bounds all
/// four orders.
///
/// With `stale_price_tolerance_bps == 0` the computed tolerance is `0`, so any non-zero
/// drift returns `false` and the guard is effectively disabled.
public(package) fun is_stale_tolerant(
    self: &AMMConfig,
    new_mid_price: u64,
    new_conf_ratio_bps: u64,
    last_mid_price: u64,
    last_conf_ratio_bps: u64,
): bool {
    // Mid drift in bps of `last_mid_price`.
    let mid_drift_bps = new_mid_price
        .diff(last_mid_price)
        .mul_div(HUNDRED_PERCENT_BPS, last_mid_price);

    // Conf moves only the outer order and weighted by `outer_balance_bps * 2 / 10_000`.
    // So the 50/50 split is `1.0` and conf weight scales to `0` as the ladder becomes inner-only.
    let conf_drift_bps = self
        .volatility_multiplier_bps
        .mul_div(new_conf_ratio_bps.diff(last_conf_ratio_bps), HUNDRED_PERCENT_BPS)
        .mul_div(self.outer_balance_bps * 2, HUNDRED_PERCENT_BPS);

    // Compute absolute tolerance bps.
    let tolerance_bps = self
        .base_spread_bps
        .mul_div(self.stale_price_tolerance_bps, HUNDRED_PERCENT_BPS);

    mid_drift_bps + conf_drift_bps < tolerance_bps
}

/// Compute the reservation mid: the oracle `mid_price` shifted by up to `base_spread`
/// toward the side that rebalances the book, scaled by `inventory_skew_bps` (fraction of
/// `base_spread` to apply at fully one-sided inventory).
/// The computed shift is always bounded by `base_spread`, so the inner order on the
/// rebalancing side never lands beyond the oracle mid.
/// Returns `mid_price` unchanged when `inventory_skew_bps == 0` or when total inventory is zero.
public(package) fun reservation_mid(
    self: &AMMConfig,
    mid_price: u64,
    base_balance: u64,
    quote_balance: u64,
): u64 {
    // If skew param is zero return mid price unchanged.
    if (self.inventory_skew_bps == 0) {
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
    let base_spread = self.base_spread(mid_price) as u128;
    let skew_bps = self.inventory_skew_bps as u128;
    let imbalance = base_balance_in_quote.diff(quote_balance);
    let shift =
        base_spread.checked_mul(imbalance).destroy_or!(abort EPriceOverflow) / total_balance;
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
