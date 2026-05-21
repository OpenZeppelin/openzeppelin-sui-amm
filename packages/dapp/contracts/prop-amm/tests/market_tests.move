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
    create_non_whitelisted_pool,
    create_pool,
    create_sui_currency,
    create_usdc_currency
};
use pyth::i64;
use pyth::price;
use std::unit_test::{assert_eq, destroy};
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
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    let market = market::new(
        &pool,
        &sui_currency,
        &usdc_currency,
        base_pyth_price_feed_id,
        quote_pyth_price_feed_id,
    );

    assert_eq!(market.pool_id(), object::id(&pool));
    assert_eq!(market.base_decimals(), sui_currency.decimals());
    assert_eq!(market.quote_decimals(), usdc_currency.decimals());
    assert_eq!(market.base_pyth_price_feed_id(), base_pyth_price_feed_id);
    assert_eq!(market.quote_pyth_price_feed_id(), quote_pyth_price_feed_id);
    assert_eq!(market.base_price_publish_time(), option::none());
    assert_eq!(market.quote_price_publish_time(), option::none());
    assert!(market.has_valid_pool(&pool));

    test_scenario::return_shared(pool);
    destroy(sui_currency);
    destroy(usdc_currency);
    destroy(market);
    scenario.end();
}

#[test, expected_failure(abort_code = market::EInvalidPythPriceFeedIdLength)]
fun create_market_rejects_empty_base_feed_id() {
    let sender = @0xB;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    destroy(
        market::new(
            &pool,
            &sui_currency,
            &usdc_currency,
            vector[],
            build_pyth_price_feed_id(1),
        ),
    );

    abort
}

#[test, expected_failure(abort_code = market::EInvalidPythPriceFeedIdLength)]
fun create_market_rejects_invalid_base_feed_id_length() {
    let sender = @0xC;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    destroy(
        market::new(
            &pool,
            &sui_currency,
            &usdc_currency,
            build_invalid_pyth_price_feed_id(),
            build_pyth_price_feed_id(1),
        ),
    );

    abort
}

#[test, expected_failure(abort_code = market::EPoolNotWhitelisted)]
fun create_market_rejects_non_whitelisted_pool() {
    let sender = @0xE;
    let mut scenario = test_scenario::begin(sender);
    scenario.next_tx(sender);
    registry::test_registry(scenario.ctx());
    let pool_id = create_non_whitelisted_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    destroy(
        market::new(
            &pool,
            &sui_currency,
            &usdc_currency,
            build_pyth_price_feed_id(0),
            build_pyth_price_feed_id(1),
        ),
    );

    abort
}

#[test, expected_failure(abort_code = market::EInvalidPythPriceFeedIdLength)]
fun create_market_rejects_invalid_quote_feed_id_length() {
    let sender = @0xD;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    destroy(
        market::new(
            &pool,
            &sui_currency,
            &usdc_currency,
            build_pyth_price_feed_id(0),
            build_invalid_pyth_price_feed_id(),
        ),
    );

    abort
}

#[test, expected_failure(abort_code = market::EIdenticalPythPriceFeedIds)]
fun create_market_rejects_identical_feed_ids() {
    let sender = @0xE;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    let feed_id = build_pyth_price_feed_id(0);
    destroy(
        market::new(
            &pool,
            &sui_currency,
            &usdc_currency,
            feed_id,
            feed_id,
        ),
    );

    abort
}

#[test]
fun deepbook_price_handles_small_base_mantissa_in_upward_branch() {
    // With `base_mantissa = 1`, `quote_mantissa = 1e10`, the old code computed
    // `base_mantissa * float_scaling / quote_mantissa = 0` and propagated zero through
    // the subsequent decimal-adjustment multiplication, aborting with EPriceUnderflow.
    // The fixed ordering (mul_div applies the decimal adjustment before the divide)
    // yields a positive DeepBook price.
    let sender = @0x10;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();
    let market = market::new(
        &pool,
        &sui_currency,
        &usdc_currency,
        build_pyth_price_feed_id(0),
        build_pyth_price_feed_id(1),
    );

    // base USD = 1 * 10^-1 = 0.1; quote USD = 1e10 * 10^-10 = 1.
    // base/quote = 0.1 -> deepbook price = 0.1 * 10^(6 - 9) * 10^9 = 1e5.
    let base_price = price::new(i64::new(1, false), 0, i64::new(1, true), 0);
    let quote_price = price::new(i64::new(10_000_000_000, false), 0, i64::new(10, true), 0);
    let (deepbook_price, conf_ratio_bps) = market.deepbook_price(base_price, quote_price, 1_000);

    assert_eq!(deepbook_price, 100_000);
    assert_eq!(conf_ratio_bps, 0);

    test_scenario::return_shared(pool);
    destroy(sui_currency);
    destroy(usdc_currency);
    destroy(market);
    scenario.end();
}

#[test]
fun deepbook_price_handles_large_decimal_adjustment() {
    // Exercises the extreme `quote_total - base_total` case (here, 15 powers of ten),
    // verifying that multiplying by `decimal_adj = 1e15` before the division does not
    // spuriously overflow the mul_div intermediate.
    let sender = @0x11;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();
    let market = market::new(
        &pool,
        &sui_currency,
        &usdc_currency,
        build_pyth_price_feed_id(0),
        build_pyth_price_feed_id(1),
    );

    // base USD = 1 * 10^-1 = 0.1; quote USD = 1e9 * 10^-19 = 1e-10.
    // base/quote = 1e9 -> deepbook price = 1e9 * 10^(6 - 9) * 10^9 = 1e15.
    let base_price = price::new(i64::new(1, false), 0, i64::new(1, true), 0);
    let quote_price = price::new(i64::new(1_000_000_000, false), 0, i64::new(19, true), 0);
    let (deepbook_price, _) = market.deepbook_price(base_price, quote_price, 1_000);

    assert_eq!(deepbook_price, 1_000_000_000_000_000);

    test_scenario::return_shared(pool);
    destroy(sui_currency);
    destroy(usdc_currency);
    destroy(market);
    scenario.end();
}

#[test]
fun deepbook_price_handles_small_base_mantissa_in_downward_branch() {
    // Mirror case to the upward-branch test: base price tiny, quote price modest, with
    // `base_total > quote_total` so the function takes the downward branch (two
    // consecutive divides). Verifies the result is a positive, correctly-floored price.
    let sender = @0x12;
    let mut scenario = test_scenario::begin(sender);
    let pool_id = create_registry_and_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();
    let market = market::new(
        &pool,
        &sui_currency,
        &usdc_currency,
        build_pyth_price_feed_id(0),
        build_pyth_price_feed_id(1),
    );

    // base USD = 1 * 10^-2 = 0.01; quote USD = 1e4 * 10^-2 = 100.
    // base/quote = 1e-4 -> deepbook price = 1e-4 * 10^(6 - 9) * 10^9 = 100.
    let base_price = price::new(i64::new(1, false), 0, i64::new(2, true), 0);
    let quote_price = price::new(i64::new(10_000, false), 0, i64::new(2, true), 0);
    let (deepbook_price, _) = market.deepbook_price(base_price, quote_price, 1_000);

    assert_eq!(deepbook_price, 100);

    test_scenario::return_shared(pool);
    destroy(sui_currency);
    destroy(usdc_currency);
    destroy(market);
    scenario.end();
}
