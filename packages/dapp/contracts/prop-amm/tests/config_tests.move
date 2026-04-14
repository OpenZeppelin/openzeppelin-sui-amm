/// Tests for AMM configuration behavior.
#[test_only]
module openzeppelin_market_maker::config_tests;

use deepbook::pool::Pool;
use deepbook::registry;
use openzeppelin_market_maker::config;
use openzeppelin_market_maker::test_helpers::{
    USDC,
    build_invalid_pyth_price_feed_id,
    build_pyth_price_feed_id,
    create_pool
};
use std::unit_test::assert_eq;
use sui::sui::SUI;
use sui::test_scenario;

fun create_registry_and_pool(scenario: &mut test_scenario::Scenario, sender: address): ID {
    scenario.next_tx(sender);
    registry::test_registry(scenario.ctx());
    create_pool(scenario, sender)
}

#[test]
fun create_amm_config_builds_expected_config() {
    let sender = @0xA;
    let base_spread_bps = 25;
    let volatility_spread_bps = 200;
    let use_laser = true;
    let base_pyth_price_feed_id = build_pyth_price_feed_id(0);
    let quote_pyth_price_feed_id = build_pyth_price_feed_id(1);
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let market_maker_config = config::create(
        &pool,
        base_spread_bps,
        volatility_spread_bps,
        use_laser,
        base_pyth_price_feed_id,
        quote_pyth_price_feed_id,
        30_000,
        30,
        1000,
    );

    assert_eq!(market_maker_config.base_spread_bps(), base_spread_bps);
    assert_eq!(market_maker_config.volatility_spread_bps(), volatility_spread_bps);
    assert_eq!(market_maker_config.use_laser(), use_laser);
    assert_eq!(market_maker_config.active(), true);
    assert_eq!(market_maker_config.base_pyth_price_feed_id(), base_pyth_price_feed_id);
    assert_eq!(market_maker_config.quote_pyth_price_feed_id(), quote_pyth_price_feed_id);
    assert_eq!(market_maker_config.max_conf_ratio_bps(), 1000);
    assert!(market_maker_config.has_valid_pool(&pool));

    test_scenario::return_shared(pool);
    scenario.end();
}

#[test, expected_failure(abort_code = config::EInvalidBaseSpreadBps)]
fun create_amm_config_rejects_zero_base_spread_bps() {
    let sender = @0xB;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        0,
        1,
        false,
        build_pyth_price_feed_id(0),
        build_pyth_price_feed_id(1),
        30_000,
        30,
        1000,
    );

    abort
}

#[test, expected_failure(abort_code = config::EBaseSpreadBpsExceedsVolatilitySpread)]
fun create_amm_config_rejects_base_spread_above_volatility_spread() {
    let sender = @0xC;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        150,
        100,
        false,
        build_pyth_price_feed_id(0),
        build_pyth_price_feed_id(1),
        30_000,
        30,
        1000,
    );

    abort
}

#[test, expected_failure(abort_code = config::EVolatilitySpreadBpsExceedsMaxBasisPoints)]
fun create_amm_config_rejects_volatility_spread_above_max_basis_points() {
    let sender = @0xD;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        100,
        10_001,
        false,
        build_pyth_price_feed_id(0),
        build_pyth_price_feed_id(1),
        30_000,
        30,
        1000,
    );

    abort
}

#[test, expected_failure(abort_code = config::EInvalidPythPriceFeedIdLength)]
fun create_amm_config_rejects_empty_feed_id() {
    let sender = @0xE;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        100,
        200,
        false,
        vector[],
        build_pyth_price_feed_id(1),
        30_000,
        30,
        1000,
    );

    abort
}

#[test, expected_failure(abort_code = config::EInvalidPythPriceFeedIdLength)]
fun create_amm_config_rejects_invalid_feed_id_length() {
    let sender = @0xF;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        100,
        200,
        false,
        build_invalid_pyth_price_feed_id(),
        build_pyth_price_feed_id(1),
        30_000,
        30,
        1000,
    );

    abort
}

#[test, expected_failure(abort_code = config::EInvalidMaxConfRatioBps)]
fun create_amm_config_rejects_zero_max_conf_ratio_bps() {
    let sender = @0x10;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        100,
        200,
        false,
        build_pyth_price_feed_id(0),
        build_pyth_price_feed_id(1),
        30_000,
        30,
        0,
    );

    abort
}

#[test, expected_failure(abort_code = config::EInvalidMaxConfRatioBps)]
fun create_amm_config_rejects_max_conf_ratio_bps_above_ten_thousand() {
    let sender = @0x11;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        100,
        200,
        false,
        build_pyth_price_feed_id(0),
        build_pyth_price_feed_id(1),
        30_000,
        30,
        10_001,
    );

    abort
}