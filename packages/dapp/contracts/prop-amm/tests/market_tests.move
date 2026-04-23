/// Tests for market metadata behavior.
#[test_only]
module openzeppelin_market_maker::market_tests;

use deepbook::pool::Pool;
use deepbook::registry;
use openzeppelin_market_maker::market;
use openzeppelin_market_maker::test_helpers::{
    USDC,
    build_invalid_pyth_price_feed_id,
    build_pyth_price_feed_id,
    create_pool
};
use std::unit_test::assert_eq;
use sui::sui::SUI;
use sui::test_scenario;

// === Test-Only Helpers ===

fun create_registry_and_pool(scenario: &mut test_scenario::Scenario, sender: address): ID {
    scenario.next_tx(sender);
    registry::test_registry(scenario.ctx());
    create_pool(scenario, sender)
}

#[test]
fun create_market_builds_expected_market() {
    let sender = @0xA;
    let base_pyth_price_feed_id = build_pyth_price_feed_id(0);
    let quote_pyth_price_feed_id = build_pyth_price_feed_id(1);
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let market = market::new(
        object::id(&pool),
        base_pyth_price_feed_id,
        quote_pyth_price_feed_id,
    );

    assert_eq!(market.pool_id(), object::id(&pool));
    assert_eq!(market.base_pyth_price_feed_id(), base_pyth_price_feed_id);
    assert_eq!(market.quote_pyth_price_feed_id(), quote_pyth_price_feed_id);
    assert_eq!(market.base_price_publish_time(), option::none());
    assert_eq!(market.quote_price_publish_time(), option::none());
    assert!(market.has_valid_pool(&pool));

    test_scenario::return_shared(pool);
    scenario.end();
}

#[test, expected_failure(abort_code = market::EInvalidPythPriceFeedIdLength)]
fun create_market_rejects_empty_base_feed_id() {
    let sender = @0xB;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let _market = market::new(
        pool_id,
        vector[],
        build_pyth_price_feed_id(1),
    );

    abort
}

#[test, expected_failure(abort_code = market::EInvalidPythPriceFeedIdLength)]
fun create_market_rejects_invalid_base_feed_id_length() {
    let sender = @0xC;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let _market = market::new(
        pool_id,
        build_invalid_pyth_price_feed_id(),
        build_pyth_price_feed_id(1),
    );

    abort
}

#[test, expected_failure(abort_code = market::EInvalidPythPriceFeedIdLength)]
fun create_market_rejects_invalid_quote_feed_id_length() {
    let sender = @0xD;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let _market = market::new(
        pool_id,
        build_pyth_price_feed_id(0),
        build_invalid_pyth_price_feed_id(),
    );

    abort
}
