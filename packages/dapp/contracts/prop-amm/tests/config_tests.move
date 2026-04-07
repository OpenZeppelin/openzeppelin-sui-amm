/// Tests for AMM configuration behavior.
#[test_only]
module openzeppelin_market_maker::config_tests;

use deepbook::constants;
use deepbook::pool::{Self, Pool};
use deepbook::registry::{Self, Registry};
use openzeppelin_market_maker::config;
use openzeppelin_market_maker::test_helpers::{
    build_invalid_pyth_price_feed_id,
    build_pyth_price_feed_id
};
use std::unit_test::{assert_eq, destroy};
use sui::sui::SUI;
use sui::test_scenario;

public struct USDC has store {}

fun create_pool(scenario: &mut test_scenario::Scenario, sender: address): ID {
    scenario.next_tx(sender);
    registry::test_registry(scenario.ctx());

    scenario.next_tx(sender);

    let deepbook_admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
    let mut deepbook_registry: Registry = scenario.take_shared();
    let pool_id = pool::create_pool_admin<SUI, USDC>(
        &mut deepbook_registry,
        constants::tick_size(),
        constants::lot_size(),
        constants::min_size(),
        true,
        false,
        &deepbook_admin_cap,
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    destroy(deepbook_admin_cap);

    pool_id
}

#[test]
fun create_amm_config_builds_expected_config() {
    let sender = @0xA;
    let base_spread_bps = 25;
    let volatility_spread_bps = 200;
    let use_laser = true;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let market_maker_config = config::create(
        &pool,
        base_spread_bps,
        volatility_spread_bps,
        use_laser,
        pyth_price_feed_id,
    );

    assert_eq!(market_maker_config.base_spread_bps(), base_spread_bps);
    assert_eq!(market_maker_config.volatility_spread_bps(), volatility_spread_bps);
    assert_eq!(market_maker_config.use_laser(), use_laser);
    assert_eq!(market_maker_config.trading_paused(), false);
    assert_eq!(market_maker_config.pyth_price_feed_id(), pyth_price_feed_id);
    assert!(market_maker_config.has_valid_pool(&pool));

    test_scenario::return_shared(pool);
    scenario.end();
}

#[test, expected_failure(abort_code = config::EInvalidBaseSpreadBps)]
fun create_amm_config_rejects_zero_base_spread_bps() {
    let sender = @0xB;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        0,
        1,
        false,
        build_pyth_price_feed_id(0),
    );

    abort
}

#[test, expected_failure(abort_code = config::EBaseSpreadBpsExceedsVolatilitySpread)]
fun create_amm_config_rejects_base_spread_above_volatility_spread() {
    let sender = @0xC;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        150,
        100,
        false,
        build_pyth_price_feed_id(0),
    );

    abort
}

#[test, expected_failure(abort_code = config::EVolatilitySpreadBpsExceedsMaxBasisPoints)]
fun create_amm_config_rejects_volatility_spread_above_max_basis_points() {
    let sender = @0xD;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        100,
        10_001,
        false,
        build_pyth_price_feed_id(0),
    );

    abort
}

#[test, expected_failure(abort_code = config::EInvalidPythPriceFeedIdLength)]
fun create_amm_config_rejects_empty_feed_id() {
    let sender = @0xE;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        100,
        200,
        false,
        vector[],
    );

    abort
}

#[test, expected_failure(abort_code = config::EInvalidPythPriceFeedIdLength)]
fun create_amm_config_rejects_invalid_feed_id_length() {
    let sender = @0xF;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let _market_maker_config = config::create(
        &pool,
        100,
        200,
        false,
        build_invalid_pyth_price_feed_id(),
    );

    abort
}