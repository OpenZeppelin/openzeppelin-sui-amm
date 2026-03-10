/// Tests for AMM manager behavior.
#[test_only]
module prop_amm::manager_tests;

use prop_amm::manager::{
    Self,
    new_amm_config_created_event,
    new_amm_config_updated_event,
    AMMAdminCap
};
use std::unit_test::{assert_eq, assert_ref_eq};
use sui::test_scenario::{Self, Scenario, TransactionEffects};

// === Helpers ===

/// Builds a dummy Pyth feed ID with a caller-provided byte value.
fun build_pyth_price_feed_id(byte_value: u8): vector<u8> {
    vector::tabulate!(manager::pyth_price_identifier_length(), |_| byte_value)
}

/// Builds a dummy Pyth feed ID with invalid length.
fun build_invalid_pyth_price_feed_id(): vector<u8> {
    vector::tabulate!(manager::pyth_price_identifier_length() - 1, |_| 0)
}

/// Runs package init in a scenario and advances to the next transaction.
fun init_and_advance_scenario(scenario: &mut Scenario, sender: address): TransactionEffects {
    manager::init_for_testing(test_scenario::ctx(scenario));
    test_scenario::next_tx(scenario, sender)
}

fun assert_config_matches_inputs(
    config: &manager::AMMConfig,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    trading_paused: bool,
    expected_pyth_price_feed_id: vector<u8>,
) {
    assert_eq!(config.base_spread_bps(), base_spread_bps);
    assert_eq!(config.volatility_multiplier_bps(), volatility_multiplier_bps);
    assert_eq!(config.use_laser(), use_laser);
    assert_eq!(config.trading_paused(), trading_paused);
    assert_eq!(config.pyth_price_feed_id(), expected_pyth_price_feed_id);
}

/// Asserts that `expected_event` of type `T` was emitted.
macro fun assert_emitted<$T>($expected_event: $T) {
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

// === Tests ===

#[test]
fun init_transfers_admin_cap() {
    let sender = @0xA;
    let mut scenario = test_scenario::begin(sender);

    init_and_advance_scenario(&mut scenario, sender);

    let admin_cap: AMMAdminCap = test_scenario::take_from_sender(&scenario);
    test_scenario::return_to_sender(&scenario, admin_cap);
    test_scenario::end(scenario);
}

#[test]
fun create_amm_config_shares_config_and_emits_event() {
    let sender = @0xB;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 25;
    let volatility_multiplier_bps = 200;
    let use_laser = true;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);

    let config_id = manager::create_amm_config_and_share(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    assert_emitted!(new_amm_config_created_event(config_id));
    scenario.next_tx(sender);

    let config = test_scenario::take_shared(&scenario);
    assert_config_matches_inputs(
        &config,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        false,
        pyth_price_feed_id,
    );

    test_scenario::return_shared(config);
    test_scenario::end(scenario);
}

#[test]
fun update_amm_config_updates_config_and_emits_event() {
    let sender = @0xC;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 25;
    let volatility_multiplier_bps = 200;
    let use_laser = true;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);

    init_and_advance_scenario(&mut scenario, sender);
    manager::create_amm_config_and_share(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let mut config = test_scenario::take_shared(&scenario);
    let updated_base_spread_bps = 35;
    let updated_volatility_multiplier_bps = 300;
    let updated_use_laser = false;
    let updated_trading_paused = true;
    let updated_pyth_price_feed_id = build_pyth_price_feed_id(1);

    manager::update_amm_config_and_emit(
        &mut config,
        &admin_cap,
        updated_base_spread_bps,
        updated_volatility_multiplier_bps,
        updated_use_laser,
        updated_trading_paused,
        updated_pyth_price_feed_id,
    );
    assert_emitted!(new_amm_config_updated_event(config.config_id()));
    scenario.next_tx(sender);

    assert_config_matches_inputs(
        &config,
        updated_base_spread_bps,
        updated_volatility_multiplier_bps,
        updated_use_laser,
        updated_trading_paused,
        updated_pyth_price_feed_id,
    );

    test_scenario::return_shared(config);
    test_scenario::return_to_sender(&scenario, admin_cap);
    test_scenario::end(scenario);
}

#[test]
fun update_amm_config_supports_multiple_updates() {
    let sender = @0xD;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 10;
    let volatility_multiplier_bps = 120;
    let use_laser = false;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);

    init_and_advance_scenario(&mut scenario, sender);
    manager::create_amm_config_and_share(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let mut config = test_scenario::take_shared(&scenario);
    let first_update_pyth_price_feed_id = build_pyth_price_feed_id(1);

    manager::update_amm_config_and_emit(
        &mut config,
        &admin_cap,
        20,
        150,
        true,
        true,
        first_update_pyth_price_feed_id,
    );
    assert_emitted!(new_amm_config_updated_event(config.config_id()));
    scenario.next_tx(sender);

    let second_update_pyth_price_feed_id = build_pyth_price_feed_id(2);
    manager::update_amm_config_and_emit(
        &mut config,
        &admin_cap,
        30,
        180,
        false,
        false,
        second_update_pyth_price_feed_id,
    );
    assert_emitted!(new_amm_config_updated_event(config.config_id()));
    scenario.next_tx(sender);

    assert_config_matches_inputs(
        &config,
        30,
        180,
        false,
        false,
        second_update_pyth_price_feed_id,
    );

    test_scenario::return_shared(config);
    test_scenario::return_to_sender(&scenario, admin_cap);
    test_scenario::end(scenario);
}

#[test, expected_failure(abort_code = manager::EInvalidBaseSpreadBps)]
fun create_amm_config_rejects_zero_base_spread_bps() {
    let base_spread_bps = 0;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);
    let ctx = &mut sui::tx_context::dummy();

    let _config = manager::create_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );

    abort
}

#[test, expected_failure(abort_code = manager::EInvalidBaseSpreadBps)]
fun update_amm_config_rejects_zero_base_spread_bps() {
    let sender = @0xD;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 1;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let trading_paused = false;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);

    init_and_advance_scenario(&mut scenario, sender);
    manager::create_amm_config_and_share(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let mut config = test_scenario::take_shared(&scenario);

    manager::update_amm_config(
        &mut config,
        &admin_cap,
        0,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        build_pyth_price_feed_id(0),
    );

    abort
}

#[test, expected_failure(abort_code = manager::EInvalidPythPriceFeedIdLength)]
fun create_amm_config_rejects_empty_feed_id() {
    let base_spread_bps = 1;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let pyth_price_feed_id = vector[];
    let ctx = &mut sui::tx_context::dummy();

    let _config = manager::create_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );

    abort
}

#[test, expected_failure(abort_code = manager::EInvalidPythPriceFeedIdLength)]
fun update_amm_config_rejects_empty_feed_id() {
    let sender = @0xE;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 1;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let trading_paused = false;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);

    init_and_advance_scenario(&mut scenario, sender);

    manager::create_amm_config_and_share(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let mut config = test_scenario::take_shared(&scenario);

    manager::update_amm_config(
        &mut config,
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        vector[],
    );

    abort
}

#[test, expected_failure(abort_code = manager::EInvalidPythPriceFeedIdLength)]
fun create_amm_config_rejects_invalid_feed_id_length() {
    let base_spread_bps = 1;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let pyth_price_feed_id = build_invalid_pyth_price_feed_id();
    let ctx = &mut sui::tx_context::dummy();

    let _config = manager::create_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );

    abort
}

#[test, expected_failure(abort_code = manager::EInvalidPythPriceFeedIdLength)]
fun update_amm_config_rejects_invalid_feed_id_length() {
    let sender = @0xF;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 1;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let trading_paused = false;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);

    init_and_advance_scenario(&mut scenario, sender);

    manager::create_amm_config_and_share(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let mut config = test_scenario::take_shared(&scenario);

    manager::update_amm_config(
        &mut config,
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        build_invalid_pyth_price_feed_id(),
    );
    
    abort
}
