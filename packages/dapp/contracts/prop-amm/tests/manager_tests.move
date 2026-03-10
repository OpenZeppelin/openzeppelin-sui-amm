/// Tests for AMM manager behavior.
#[test_only]
module prop_amm::manager_tests;

use prop_amm::manager;
use std::unit_test::{assert_eq, assert_ref_eq};
use sui::test_scenario::{Self, Scenario, TransactionEffects};

// === Helpers ===

/// Builds a dummy Pyth feed ID with a caller-provided byte value.
fun build_pyth_price_feed_id_for_tests(byte_value: u8): vector<u8> {
    vector::tabulate!(manager::pyth_price_identifier_length(), |_| byte_value)
}

/// Runs package init in a scenario and advances to the next transaction.
fun init_and_advance_scenario(scenario: &mut Scenario, sender: address): TransactionEffects {
    manager::init_for_testing(test_scenario::ctx(scenario));
    test_scenario::next_tx(scenario, sender)
}

/// Creates a config, shares it, and advances to the next transaction.
fun create_and_share_amm_config_and_advance_scenario(
    scenario: &mut Scenario,
    sender: address,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
): TransactionEffects {
    manager::create_amm_config_and_share(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        test_scenario::ctx(scenario),
    );
    test_scenario::next_tx(scenario, sender)
}

/// Updates a config, returns resources to the scenario, and advances.
fun update_amm_config_and_advance_scenario(
    mut config: manager::AMMConfig,
    scenario: &mut Scenario,
    admin_cap: manager::AMMAdminCap,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    trading_paused: bool,
    pyth_price_feed_id: vector<u8>,
    sender: address,
): TransactionEffects {
    manager::update_amm_config_and_emit(
        &mut config,
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        pyth_price_feed_id,
    );
    return_admin_cap_to_scenario(scenario, admin_cap);
    return_config_to_scenario(config);
    test_scenario::next_tx(scenario, sender)
}

fun take_admin_cap_from_scenario(scenario: &Scenario): manager::AMMAdminCap {
    test_scenario::take_from_sender<manager::AMMAdminCap>(scenario)
}

fun take_config_from_scenario(scenario: &Scenario): manager::AMMConfig {
    test_scenario::take_shared<manager::AMMConfig>(scenario)
}

fun return_admin_cap_to_scenario(scenario: &Scenario, admin_cap: manager::AMMAdminCap) {
    test_scenario::return_to_sender(scenario, admin_cap);
}

fun return_config_to_scenario(config: manager::AMMConfig) {
    test_scenario::return_shared(config);
}

fun assert_config_matches_inputs(
    config: &manager::AMMConfig,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    trading_paused: bool,
    expected_pyth_price_feed_id: &vector<u8>,
) {
    assert_eq!(config.base_spread_bps(), base_spread_bps);
    assert_eq!(config.volatility_multiplier_bps(), volatility_multiplier_bps);
    assert_eq!(config.use_laser(), use_laser);
    assert_eq!(config.trading_paused(), trading_paused);
    assert_ref_eq!(config.pyth_price_feed_id(), expected_pyth_price_feed_id);
}

// === Tests ===

#[test]
fun init_transfers_admin_cap() {
    let sender = @0xA;
    let mut scenario = test_scenario::begin(sender);

    init_and_advance_scenario(&mut scenario, sender);

    let admin_cap = take_admin_cap_from_scenario(&scenario);
    return_admin_cap_to_scenario(&scenario, admin_cap);
    test_scenario::end(scenario);
}

#[test]
fun create_amm_config_shares_config_and_emits_event() {
    let sender = @0xB;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 25;
    let volatility_multiplier_bps = 200;
    let use_laser = true;
    let pyth_price_feed_id = build_pyth_price_feed_id_for_tests(0);
    let expected_pyth_price_feed_id = build_pyth_price_feed_id_for_tests(0);

    let effects = create_and_share_amm_config_and_advance_scenario(
        &mut scenario,
        sender,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
    );

    assert_eq!(test_scenario::num_user_events(&effects), 1);

    let config = take_config_from_scenario(&scenario);
    assert_config_matches_inputs(
        &config,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        false,
        &expected_pyth_price_feed_id,
    );

    return_config_to_scenario(config);
    test_scenario::end(scenario);
}

#[test]
fun update_amm_config_updates_config_and_emits_event() {
    let sender = @0xC;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 25;
    let volatility_multiplier_bps = 200;
    let use_laser = true;
    let pyth_price_feed_id = build_pyth_price_feed_id_for_tests(0);

    init_and_advance_scenario(&mut scenario, sender);
    create_and_share_amm_config_and_advance_scenario(
        &mut scenario,
        sender,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
    );

    let admin_cap = take_admin_cap_from_scenario(&scenario);
    let config = take_config_from_scenario(&scenario);
    let updated_base_spread_bps = 35;
    let updated_volatility_multiplier_bps = 300;
    let updated_use_laser = false;
    let updated_trading_paused = true;
    let updated_pyth_price_feed_id = build_pyth_price_feed_id_for_tests(1);

    let effects = update_amm_config_and_advance_scenario(
        config,
        &mut scenario,
        admin_cap,
        updated_base_spread_bps,
        updated_volatility_multiplier_bps,
        updated_use_laser,
        updated_trading_paused,
        updated_pyth_price_feed_id,
        sender,
    );

    assert_eq!(test_scenario::num_user_events(&effects), 1);

    let updated_config = take_config_from_scenario(&scenario);
    let expected_pyth_price_feed_id = build_pyth_price_feed_id_for_tests(1);
    assert_config_matches_inputs(
        &updated_config,
        updated_base_spread_bps,
        updated_volatility_multiplier_bps,
        updated_use_laser,
        updated_trading_paused,
        &expected_pyth_price_feed_id,
    );

    return_config_to_scenario(updated_config);

    let admin_cap = take_admin_cap_from_scenario(&scenario);
    return_admin_cap_to_scenario(&scenario, admin_cap);
    test_scenario::end(scenario);
}

#[test]
fun update_amm_config_supports_multiple_updates() {
    let sender = @0xD;
    let mut scenario = test_scenario::begin(sender);
    let base_spread_bps = 10;
    let volatility_multiplier_bps = 120;
    let use_laser = false;
    let pyth_price_feed_id = build_pyth_price_feed_id_for_tests(0);

    init_and_advance_scenario(&mut scenario, sender);
    create_and_share_amm_config_and_advance_scenario(
        &mut scenario,
        sender,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
    );

    let first_admin_cap = take_admin_cap_from_scenario(&scenario);
    let first_config = take_config_from_scenario(&scenario);
    let first_update_pyth_price_feed_id = build_pyth_price_feed_id_for_tests(1);
    let first_update_effects = update_amm_config_and_advance_scenario(
        first_config,
        &mut scenario,
        first_admin_cap,
        20,
        150,
        true,
        true,
        first_update_pyth_price_feed_id,
        sender,
    );
    assert_eq!(test_scenario::num_user_events(&first_update_effects), 1);

    let second_admin_cap = take_admin_cap_from_scenario(&scenario);
    let second_config = take_config_from_scenario(&scenario);
    let second_update_pyth_price_feed_id = build_pyth_price_feed_id_for_tests(2);
    let second_update_effects = update_amm_config_and_advance_scenario(
        second_config,
        &mut scenario,
        second_admin_cap,
        30,
        180,
        false,
        false,
        second_update_pyth_price_feed_id,
        sender,
    );
    assert_eq!(test_scenario::num_user_events(&second_update_effects), 1);

    let updated_config = take_config_from_scenario(&scenario);
    let expected_pyth_price_feed_id = build_pyth_price_feed_id_for_tests(2);
    assert_config_matches_inputs(
        &updated_config,
        30,
        180,
        false,
        false,
        &expected_pyth_price_feed_id,
    );

    return_config_to_scenario(updated_config);

    let admin_cap = take_admin_cap_from_scenario(&scenario);
    return_admin_cap_to_scenario(&scenario, admin_cap);
    test_scenario::end(scenario);
}

#[test, expected_failure(abort_code = manager::EInvalidBaseSpreadBps)]
fun create_amm_config_rejects_zero_base_spread_bps() {
    let base_spread_bps = 0;
    let volatility_multiplier_bps = 1;
    let use_laser = false;
    let pyth_price_feed_id = build_pyth_price_feed_id_for_tests(0);
    let ctx = &mut sui::tx_context::dummy();

    let config = manager::create_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );
    manager::share_amm_config(config);
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
    let pyth_price_feed_id = build_pyth_price_feed_id_for_tests(0);

    init_and_advance_scenario(&mut scenario, sender);
    create_and_share_amm_config_and_advance_scenario(
        &mut scenario,
        sender,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
    );

    let admin_cap = take_admin_cap_from_scenario(&scenario);
    let mut config = take_config_from_scenario(&scenario);

    manager::update_amm_config(
        &mut config,
        &admin_cap,
        0,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        build_pyth_price_feed_id_for_tests(0),
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

    let config = manager::create_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );
    manager::share_amm_config(config);
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

    init_and_advance_scenario(&mut scenario, sender);
    create_and_share_amm_config_and_advance_scenario(
        &mut scenario,
        sender,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        build_pyth_price_feed_id_for_tests(0),
    );

    let admin_cap = take_admin_cap_from_scenario(&scenario);
    let mut config = take_config_from_scenario(&scenario);

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
    let pyth_price_feed_id = vector::tabulate!(manager::pyth_price_identifier_length() - 1, |_| 0);
    let ctx = &mut sui::tx_context::dummy();

    let config = manager::create_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );
    manager::share_amm_config(config);
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

    init_and_advance_scenario(&mut scenario, sender);
    create_and_share_amm_config_and_advance_scenario(
        &mut scenario,
        sender,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        build_pyth_price_feed_id_for_tests(0),
    );

    let admin_cap = take_admin_cap_from_scenario(&scenario);
    let mut config = take_config_from_scenario(&scenario);

    manager::update_amm_config(
        &mut config,
        &admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        vector::tabulate!(manager::pyth_price_identifier_length() - 1, |_| 0),
    );
    abort
}
