#[test_only]
module openzeppelin_market_maker::test_helpers;

use openzeppelin_market_maker::config;
use deepbook::constants;
use deepbook::pool;
use deepbook::registry;
use sui::coin;
use sui::coin_registry::{Self, Currency};
use sui::sui::SUI;
use sui::test_scenario;

/// Test-only USDC type for DeepBook pool quote asset.
public struct USDC has key {
    id: UID,
}

/// Test-only USDT type used only for pool mismatch testing.
public struct USDT has key {
    id: UID,
}

/// Creates a `Currency<USDC>` for testing via `coin_registry`.
/// Uses `tx_context::dummy()` to get a context with sender `@0x0` (required by coin_registry).
public(package) fun create_usdc_currency(): Currency<USDC> {
    let ctx = &mut tx_context::dummy();
    let mut registry = coin_registry::create_coin_data_registry_for_testing(ctx);
    let (init, treasury_cap) = coin_registry::new_currency<USDC>(
        &mut registry, 6, b"USDC".to_string(),
        b"".to_string(), b"".to_string(), b"".to_string(), ctx,
    );
    let currency = coin_registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry);
    std::unit_test::destroy(treasury_cap);
    currency
}

/// Creates a `Currency<USDT>` for testing via `coin_registry`.
public(package) fun create_usdt_currency(): Currency<USDT> {
    let ctx = &mut tx_context::dummy();
    let mut registry = coin_registry::create_coin_data_registry_for_testing(ctx);
    let (init, treasury_cap) = coin_registry::new_currency<USDT>(
        &mut registry, 6, b"USDT".to_string(),
        b"".to_string(), b"".to_string(), b"".to_string(), ctx,
    );
    let currency = coin_registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry);
    std::unit_test::destroy(treasury_cap);
    currency
}

/// Creates a `Currency<SUI>` for testing from legacy `CoinMetadata`.
/// Uses `tx_context::dummy()` to get a context with sender `@0x0` (required by coin_registry).
#[allow(deprecated_usage)]
public(package) fun create_sui_currency(): Currency<SUI> {
    let ctx = &mut tx_context::dummy();
    let otw = sui::test_utils::create_one_time_witness<SUI>();
    let (treasury_cap, metadata) = coin::create_currency(
        otw,
        9,
        b"SUI",
        b"",
        b"",
        option::none(),
        ctx,
    );
    let mut registry = coin_registry::create_coin_data_registry_for_testing(ctx);
    let currency = coin_registry::migrate_legacy_metadata_for_testing<SUI>(
        &mut registry,
        &metadata,
        ctx,
    );
    std::unit_test::destroy(registry);
    std::unit_test::destroy(treasury_cap);
    std::unit_test::destroy(metadata);
    currency
}

/// Creates a DeepBook `Pool<SUI, USDC>` in the test scenario.
/// Assumes a DeepBook registry already exists as a shared object.
public(package) fun create_pool(scenario: &mut test_scenario::Scenario, sender: address): ID {
    scenario.next_tx(sender);

    let deepbook_admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
    let mut deepbook_registry: deepbook::registry::Registry = scenario.take_shared();
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
    std::unit_test::destroy(deepbook_admin_cap);

    pool_id
}

/// Asserts that `expected_event` of type `T` was emitted within current transaction
/// (before `test_scenario::next_tx`).
public(package) macro fun assert_emitted<$T>($expected_event: $T) {
    let events = sui::event::events_by_type<$T>();
    if (events.length() == 0) {
        std::debug::print(&b"Assertion failed. No events emitted.".to_string());
        abort
    };
    let emitted = events.any!(|event| event == $expected_event);
    if (!emitted) {
        std::debug::print(&b"Assertion failed. Different events emitted:".to_string());
        std::debug::print(&events);
        std::debug::print(&b"No matching events".to_string());
        abort
    };
}

/// Builds a dummy Pyth feed ID with a caller-provided byte value.
public(package) fun build_pyth_price_feed_id(byte_value: u8): vector<u8> {
    vector::tabulate!(config::pyth_price_identifier_length(), |_| byte_value)
}

/// Builds a dummy Pyth feed ID with invalid length.
public(package) fun build_invalid_pyth_price_feed_id(): vector<u8> {
    vector::tabulate!(config::pyth_price_identifier_length() - 1, |_| 0)
}
