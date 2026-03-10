/// Tests for AMM manager behavior.
#[test_only]
module openzeppelin_automated_market_maker::manager_tests;

use openzeppelin_automated_market_maker::manager::{
    Self,
    new_amm_config_created_event,
    new_amm_config_updated_event,
    AMMAdminCap,
    AMMConfig
};
use std::unit_test::assert_eq;
use sui::test_scenario;

// === Helpers ===

/// Builds a dummy Pyth feed ID with a caller-provided byte value.
fun build_pyth_price_feed_id(byte_value: u8): vector<u8> {
    vector::tabulate!(manager::pyth_price_identifier_length(), |_| byte_value)
}

/// Builds a dummy Pyth feed ID with invalid length.
fun build_invalid_pyth_price_feed_id(): vector<u8> {
    vector::tabulate!(manager::pyth_price_identifier_length() - 1, |_| 0)
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

    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

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

    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let config_id = manager::create_amm_config_and_share(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    assert_emitted!(new_amm_config_created_event(config_id));
    scenario.next_tx(sender);

    let config: AMMConfig = test_scenario::take_shared(&scenario);

    assert_eq!(config.base_spread_bps(), base_spread_bps);
    assert_eq!(config.volatility_multiplier_bps(), volatility_multiplier_bps);
    assert_eq!(config.use_laser(), use_laser);
    assert_eq!(config.trading_paused(), false);
    assert_eq!(config.pyth_price_feed_id(), pyth_price_feed_id);

    test_scenario::return_shared(config);
    test_scenario::return_to_sender(&scenario, admin_cap);
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

    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    manager::create_amm_config_and_share(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let mut config: AMMConfig = test_scenario::take_shared(&scenario);
    let updated_base_spread_bps = 35;
    let updated_volatility_multiplier_bps = 300;
    let updated_use_laser = false;
    let updated_trading_paused = true;
    let updated_pyth_price_feed_id = build_pyth_price_feed_id(1);

    config.update_amm_config_and_emit(
        &admin_cap,
        updated_base_spread_bps,
        updated_volatility_multiplier_bps,
        updated_use_laser,
        updated_trading_paused,
        updated_pyth_price_feed_id,
    );
    assert_emitted!(new_amm_config_updated_event(config.config_id()));
    scenario.next_tx(sender);

    assert_eq!(config.base_spread_bps(), updated_base_spread_bps);
    assert_eq!(config.volatility_multiplier_bps(), updated_volatility_multiplier_bps);
    assert_eq!(config.use_laser(), updated_use_laser);
    assert_eq!(config.trading_paused(), updated_trading_paused);
    assert_eq!(config.pyth_price_feed_id(), updated_pyth_price_feed_id);

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

    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    manager::create_amm_config_and_share(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let mut config: AMMConfig = test_scenario::take_shared(&scenario);
    let first_update_pyth_price_feed_id = build_pyth_price_feed_id(1);

    config.update_amm_config_and_emit(
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
    config.update_amm_config_and_emit(
        &admin_cap,
        30,
        180,
        false,
        false,
        second_update_pyth_price_feed_id,
    );
    assert_emitted!(new_amm_config_updated_event(config.config_id()));
    scenario.next_tx(sender);

    assert_eq!(config.base_spread_bps(), 30);
    assert_eq!(config.volatility_multiplier_bps(), 180);
    assert_eq!(config.use_laser(), false);
    assert_eq!(config.trading_paused(), false);
    assert_eq!(config.pyth_price_feed_id(), second_update_pyth_price_feed_id);

    test_scenario::return_shared(config);
    test_scenario::return_to_sender(&scenario, admin_cap);
    test_scenario::end(scenario);
}

#[test, expected_failure(abort_code = manager::EInvalidBaseSpreadBps)]
fun create_amm_config_rejects_zero_base_spread_bps() {
    let sender = @0x10;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 0;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let pyth_price_feed_id = build_pyth_price_feed_id(0);
    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let _config = manager::create_amm_config(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
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

    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    manager::create_amm_config_and_share(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let mut config: AMMConfig = test_scenario::take_shared(&scenario);

    config.update_amm_config(
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
    let sender = @0x11;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 1;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let pyth_price_feed_id = vector[];
    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let _config = manager::create_amm_config(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
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

    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    manager::create_amm_config_and_share(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let mut config: AMMConfig = test_scenario::take_shared(&scenario);

    config.update_amm_config(
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
    let sender = @0x12;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 1;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let pyth_price_feed_id = build_invalid_pyth_price_feed_id();
    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    let _config = manager::create_amm_config(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
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

    manager::test_init(scenario.ctx());
    scenario.next_tx(sender);

    let admin_cap = test_scenario::take_from_sender(&scenario);
    manager::create_amm_config_and_share(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        scenario.ctx(),
    );
    scenario.next_tx(sender);

    let mut config: AMMConfig = test_scenario::take_shared(&scenario);

    config.update_amm_config(
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        build_invalid_pyth_price_feed_id(),
    );

    abort
}
