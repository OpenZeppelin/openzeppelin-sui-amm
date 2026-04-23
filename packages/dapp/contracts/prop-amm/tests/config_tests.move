/// Tests for AMM configuration behavior.
#[test_only]
module openzeppelin_market_maker::config_tests;

use openzeppelin_market_maker::config;
use std::unit_test::assert_eq;

#[test]
fun create_amm_config_builds_expected_config() {
    let base_spread_bps = 25;
    let volatility_spread_bps = 200;

    let amm_config = config::new(
        base_spread_bps,
        volatility_spread_bps,
        30_000,
        30,
        1000,
        5000,
    );

    assert_eq!(amm_config.base_spread_bps(), base_spread_bps);
    assert_eq!(amm_config.volatility_spread_bps(), volatility_spread_bps);
    assert_eq!(amm_config.order_expiration_time_ms(), 30_000);
    assert_eq!(amm_config.max_price_age_secs(), 30);
    assert_eq!(amm_config.max_conf_ratio_bps(), 1000);
    assert_eq!(amm_config.outer_balance_bps(), 5000);
}

#[test, expected_failure(abort_code = config::EInvalidBaseSpreadBps)]
fun create_amm_config_rejects_zero_base_spread_bps() {
    let _amm_config = config::new(0, 1, 30_000, 30, 1000, 5000);

    abort
}

#[test, expected_failure(abort_code = config::EBaseSpreadBpsExceedsVolatilitySpread)]
fun create_amm_config_rejects_base_spread_above_volatility_spread() {
    let _amm_config = config::new(150, 100, 30_000, 30, 1000, 5000);

    abort
}

#[test, expected_failure(abort_code = config::EVolatilitySpreadBpsExceedsMaxBasisPoints)]
fun create_amm_config_rejects_volatility_spread_above_max_basis_points() {
    let _amm_config = config::new(100, 10_001, 30_000, 30, 1000, 5000);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidMaxConfRatioBps)]
fun create_amm_config_rejects_zero_max_conf_ratio_bps() {
    let _amm_config = config::new(100, 200, 30_000, 30, 0, 5000);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidMaxConfRatioBps)]
fun create_amm_config_rejects_max_conf_ratio_bps_above_ten_thousand() {
    let _amm_config = config::new(100, 200, 30_000, 30, 10_001, 5000);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidOrderExpirationTime)]
fun create_amm_config_rejects_zero_order_expiration_time() {
    let _amm_config = config::new(100, 200, 0, 30, 1000, 5000);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidMaxPriceAge)]
fun create_amm_config_rejects_zero_max_price_age() {
    let _amm_config = config::new(100, 200, 30_000, 0, 1000, 5000);

    abort
}

#[test]
fun create_amm_config_accepts_zero_outer_balance_bps() {
    let amm_config = config::new(100, 200, 30_000, 30, 1000, 0);

    assert_eq!(amm_config.outer_balance_bps(), 0);
}

#[test, expected_failure(abort_code = config::EInvalidOuterBalanceBps)]
fun create_amm_config_rejects_outer_balance_bps_at_hundred_percent() {
    let _amm_config = config::new(100, 200, 30_000, 30, 1000, 10_000);

    abort
}

#[test, expected_failure(abort_code = config::EInvalidOuterBalanceBps)]
fun create_amm_config_rejects_outer_balance_bps_above_ten_thousand() {
    let _amm_config = config::new(100, 200, 30_000, 30, 1000, 10_001);

    abort
}
