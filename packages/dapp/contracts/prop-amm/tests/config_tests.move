/// Tests for AMM configuration behavior.
#[test_only]
module openzeppelin_market_maker::config_tests;

use openzeppelin_market_maker::config;
use std::unit_test::assert_eq;

#[test]
fun create_amm_config_builds_expected_config() {
    let base_spread_bps = 25;
    let volatility_multiplier_bps = 10_000;

    let amm_config = config::new(
        base_spread_bps,
        volatility_multiplier_bps,
        30_000,
        30,
        1000,
        5000,
        0,
        0,
        true,
    );

    assert_eq!(amm_config.base_spread_bps(), base_spread_bps);
    assert_eq!(amm_config.volatility_multiplier_bps(), volatility_multiplier_bps);
    assert_eq!(amm_config.order_expiration_time_ms(), 30_000);
    assert_eq!(amm_config.max_price_age_secs(), 30);
    assert_eq!(amm_config.max_conf_ratio_bps(), 1000);
    assert_eq!(amm_config.outer_balance_bps(), 5000);
    assert_eq!(amm_config.inventory_skew_bps(), 0);
    assert_eq!(amm_config.stale_price_tolerance_bps(), 0);
    assert_eq!(amm_config.post_only(), true);
}

#[test, expected_failure(abort_code = config::EInvalidBaseSpreadBps)]
fun create_amm_config_rejects_zero_base_spread_bps() {
    let _amm_config = config::new(0, 10_000, 30_000, 30, 1000, 5000, 0, 0, true);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidBaseSpreadBps)]
fun create_amm_config_rejects_base_spread_bps_above_ten_thousand() {
    let _amm_config = config::new(10_001, 10_000, 30_000, 30, 1000, 5000, 0, 0, true);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidMaxConfRatioBps)]
fun create_amm_config_rejects_zero_max_conf_ratio_bps() {
    let _amm_config = config::new(100, 10_000, 30_000, 30, 0, 5000, 0, 0, true);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidMaxConfRatioBps)]
fun create_amm_config_rejects_max_conf_ratio_bps_above_ten_thousand() {
    let _amm_config = config::new(100, 10_000, 30_000, 30, 10_001, 5000, 0, 0, true);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidOrderExpirationTime)]
fun create_amm_config_rejects_zero_order_expiration_time() {
    let _amm_config = config::new(100, 10_000, 0, 30, 1000, 5000, 0, 0, true);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidMaxPriceAge)]
fun create_amm_config_rejects_zero_max_price_age() {
    let _amm_config = config::new(100, 10_000, 30_000, 0, 1000, 5000, 0, 0, true);

    abort
}

#[test]
fun create_amm_config_accepts_zero_outer_balance_bps() {
    let amm_config = config::new(100, 10_000, 30_000, 30, 1000, 0, 0, 0, true);

    assert_eq!(amm_config.outer_balance_bps(), 0);
}

#[test, expected_failure(abort_code = config::EInvalidOuterBalanceBps)]
fun create_amm_config_rejects_outer_balance_bps_at_hundred_percent() {
    let _amm_config = config::new(100, 10_000, 30_000, 30, 1000, 10_000, 0, 0, true);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidOuterBalanceBps)]
fun create_amm_config_rejects_outer_balance_bps_above_ten_thousand() {
    let _amm_config = config::new(100, 10_000, 30_000, 30, 1000, 10_001, 0, 0, true);

    abort
}

#[test]
fun create_amm_config_accepts_inventory_skew_bps_just_below_hundred_percent() {
    let amm_config = config::new(100, 10_000, 30_000, 30, 1000, 5000, 9_999, 0, true);

    assert_eq!(amm_config.inventory_skew_bps(), 9_999);
}

#[test, expected_failure(abort_code = config::EInvalidInventorySkewBps)]
fun create_amm_config_rejects_inventory_skew_bps_at_hundred_percent() {
    let _amm_config = config::new(100, 10_000, 30_000, 30, 1000, 5000, 10_000, 0, true);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidInventorySkewBps)]
fun create_amm_config_rejects_inventory_skew_bps_above_ten_thousand() {
    let _amm_config = config::new(100, 10_000, 30_000, 30, 1000, 5000, 10_001, 0, true);

    abort
}
