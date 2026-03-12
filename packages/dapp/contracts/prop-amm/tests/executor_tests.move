/// Tests for AMM executor behavior.
#[test_only]
module openzeppelin_market_maker::executor_tests;

use deepbook::balance_manager;
use deepbook::registry;
use openzeppelin_market_maker::executor;
use std::unit_test::{assert_eq, destroy};
use sui::dynamic_field;
use sui::test_scenario;
use sui::vec_set;

// === Imports ===

// === Constants ===

const ADMIN_ADDRESS: address = @0xA;
const OWNER_ADDRESS: address = @0xB;
const OTHER_ADDRESS: address = @0xC;

// === Helpers ===

/// Creates a registry and advances the scenario.
fun create_registry_and_advance_scenario(
    scenario: &mut test_scenario::Scenario,
    sender: address,
): ID {
    let registry_id;
    test_scenario::next_tx(scenario, sender);
    {
        registry_id = registry::test_registry(test_scenario::ctx(scenario));
    };
    registry_id
}

/// Authorizes the app and initializes the balance manager map.
fun authorize_app_and_initialize_balance_manager_map(
    scenario: &mut test_scenario::Scenario,
    sender: address,
    registry_id: ID,
) {
    test_scenario::next_tx(scenario, sender);
    {
        let mut registry = take_registry_from_scenario(scenario, registry_id);
        let admin_cap = registry::get_admin_cap_for_testing(test_scenario::ctx(scenario));
        registry::authorize_app<executor::PropAmmApp>(&mut registry, &admin_cap);
        registry::init_balance_manager_map(
            &mut registry,
            &admin_cap,
            test_scenario::ctx(scenario),
        );
        return_registry_to_scenario(registry);
        destroy(admin_cap);
    };
}

/// Authorizes the app without initializing the balance manager map.
fun authorize_app_without_balance_manager_map(
    scenario: &mut test_scenario::Scenario,
    sender: address,
    registry_id: ID,
) {
    test_scenario::next_tx(scenario, sender);
    {
        let mut registry = take_registry_from_scenario(scenario, registry_id);
        let admin_cap = registry::get_admin_cap_for_testing(test_scenario::ctx(scenario));
        registry::authorize_app<executor::PropAmmApp>(&mut registry, &admin_cap);
        return_registry_to_scenario(registry);
        destroy(admin_cap);
    };
}

/// Creates a trader account via PTB composition and advances the scenario.
fun create_trader_account_and_advance_scenario(
    scenario: &mut test_scenario::Scenario,
    sender: address,
    registry_id: ID,
    owner: address,
): ID {
    let balance_manager_id;
    test_scenario::next_tx(scenario, sender);
    {
        let registry = take_registry_from_scenario(scenario, registry_id);
        let (
            balance_manager,
            deposit_cap,
            withdraw_cap,
            trade_cap,
            trader_account,
            _,
        ) = executor::create_trader_account_components(
            &registry,
            owner,
            test_scenario::ctx(scenario),
        );

        assert_eq!(executor::owner(&trader_account), owner);
        balance_manager_id = balance_manager::id(&balance_manager);
        assert_eq!(executor::balance_manager_id(&trader_account), balance_manager_id);
        assert_trader_account_matches_caps(
            &trader_account,
            object::id(&trade_cap),
            object::id(&deposit_cap),
            object::id(&withdraw_cap),
        );

        transfer::public_transfer(deposit_cap, owner);
        transfer::public_transfer(withdraw_cap, owner);
        transfer::public_transfer(trade_cap, owner);
        executor::transfer_trader_account_to_owner(trader_account);
        transfer::public_share_object(balance_manager);

        return_registry_to_scenario(registry);
    };
    test_scenario::next_tx(scenario, sender);
    balance_manager_id
}

/// Prepares an authorized registry and composed trader account state.
fun prepare_authorized_registry_and_trader_account(
    scenario: &mut test_scenario::Scenario,
    admin: address,
    owner: address,
    initialize_balance_manager_map: bool,
): (ID, ID) {
    let registry_id = create_registry_and_advance_scenario(scenario, admin);

    if (initialize_balance_manager_map) {
        authorize_app_and_initialize_balance_manager_map(scenario, admin, registry_id);
    } else {
        authorize_app_without_balance_manager_map(scenario, admin, registry_id);
    };

    let balance_manager_id = create_trader_account_and_advance_scenario(
        scenario,
        admin,
        registry_id,
        owner,
    );

    (registry_id, balance_manager_id)
}

/// Takes the registry from the scenario by ID.
fun take_registry_from_scenario(
    scenario: &test_scenario::Scenario,
    registry_id: ID,
): registry::Registry {
    test_scenario::take_shared_by_id<registry::Registry>(scenario, registry_id)
}

/// Returns the registry to the scenario.
fun return_registry_to_scenario(registry: registry::Registry) {
    test_scenario::return_shared(registry);
}

/// Takes a shared balance manager from the scenario by ID.
fun take_shared_balance_manager_from_scenario(
    scenario: &test_scenario::Scenario,
    balance_manager_id: ID,
): balance_manager::BalanceManager {
    test_scenario::take_shared_by_id<balance_manager::BalanceManager>(
        scenario,
        balance_manager_id,
    )
}

/// Returns a shared balance manager to the scenario.
fun return_shared_balance_manager_to_scenario(balance_manager: balance_manager::BalanceManager) {
    test_scenario::return_shared(balance_manager);
}

/// Takes the trader account from the scenario.
fun take_trader_account_from_scenario(scenario: &test_scenario::Scenario): executor::TraderAccount {
    test_scenario::take_from_sender<executor::TraderAccount>(scenario)
}

/// Returns the trader account to the scenario.
fun return_trader_account_to_scenario(
    scenario: &test_scenario::Scenario,
    trader_account: executor::TraderAccount,
) {
    test_scenario::return_to_sender(scenario, trader_account);
}

/// Takes the trade cap from the scenario.
fun take_trade_cap_from_scenario(scenario: &test_scenario::Scenario): balance_manager::TradeCap {
    test_scenario::take_from_sender<balance_manager::TradeCap>(scenario)
}

/// Takes the deposit cap from the scenario.
fun take_deposit_cap_from_scenario(
    scenario: &test_scenario::Scenario,
): balance_manager::DepositCap {
    test_scenario::take_from_sender<balance_manager::DepositCap>(scenario)
}

/// Takes the withdraw cap from the scenario.
fun take_withdraw_cap_from_scenario(
    scenario: &test_scenario::Scenario,
): balance_manager::WithdrawCap {
    test_scenario::take_from_sender<balance_manager::WithdrawCap>(scenario)
}

/// Returns all caps to the scenario.
fun return_caps_to_scenario(
    scenario: &test_scenario::Scenario,
    deposit_cap: balance_manager::DepositCap,
    withdraw_cap: balance_manager::WithdrawCap,
    trade_cap: balance_manager::TradeCap,
) {
    test_scenario::return_to_sender(scenario, deposit_cap);
    test_scenario::return_to_sender(scenario, withdraw_cap);
    test_scenario::return_to_sender(scenario, trade_cap);
}

/// Takes the owner-side trader account bundle from the scenario.
fun take_owner_side_trader_account_bundle(
    scenario: &test_scenario::Scenario,
): (
    executor::TraderAccount,
    balance_manager::DepositCap,
    balance_manager::WithdrawCap,
    balance_manager::TradeCap,
) {
    (
        take_trader_account_from_scenario(scenario),
        take_deposit_cap_from_scenario(scenario),
        take_withdraw_cap_from_scenario(scenario),
        take_trade_cap_from_scenario(scenario),
    )
}

/// Takes the trader account and bound shared balance manager from the scenario.
fun take_trader_account_and_bound_balance_manager(
    scenario: &test_scenario::Scenario,
    balance_manager_id: ID,
): (executor::TraderAccount, balance_manager::BalanceManager) {
    (
        take_trader_account_from_scenario(scenario),
        take_shared_balance_manager_from_scenario(scenario, balance_manager_id),
    )
}

/// Asserts that a trader account matches the expected cap IDs.
fun assert_trader_account_matches_caps(
    trader_account: &executor::TraderAccount,
    trade_cap_id: ID,
    deposit_cap_id: ID,
    withdraw_cap_id: ID,
) {
    assert_eq!(executor::trade_cap_id(trader_account), option::some(trade_cap_id));
    assert_eq!(executor::deposit_cap_id(trader_account), option::some(deposit_cap_id));
    assert_eq!(executor::withdraw_cap_id(trader_account), option::some(withdraw_cap_id));
}

// === Constructor-Level Tests ===

/// Creates trader account objects and validates constructor-level invariants.
#[test]
fun create_trader_account_constructor_happy_path() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let registry_id = create_registry_and_advance_scenario(&mut scenario, ADMIN_ADDRESS);
    authorize_app_and_initialize_balance_manager_map(
        &mut scenario,
        ADMIN_ADDRESS,
        registry_id,
    );

    test_scenario::next_tx(&mut scenario, ADMIN_ADDRESS);
    {
        let registry = take_registry_from_scenario(&scenario, registry_id);
        let (
            balance_manager,
            deposit_cap,
            withdraw_cap,
            trade_cap,
            trader_account,
            _,
        ) = executor::create_trader_account_components(
            &registry,
            OWNER_ADDRESS,
            test_scenario::ctx(&mut scenario),
        );

        assert_eq!(executor::owner(&trader_account), OWNER_ADDRESS);
        let balance_manager_id = balance_manager::id(&balance_manager);
        assert_eq!(executor::balance_manager_id(&trader_account), balance_manager_id);
        assert_trader_account_matches_caps(
            &trader_account,
            object::id(&trade_cap),
            object::id(&deposit_cap),
            object::id(&withdraw_cap),
        );

        return_registry_to_scenario(registry);
        transfer::public_share_object(balance_manager);
        transfer::public_transfer(deposit_cap, OWNER_ADDRESS);
        transfer::public_transfer(withdraw_cap, OWNER_ADDRESS);
        transfer::public_transfer(trade_cap, OWNER_ADDRESS);
        executor::transfer_trader_account_to_owner(trader_account);
    };

    test_scenario::end(scenario);
}

/// Rejects constructor-level trader account creation when the app is not authorized.
#[test, expected_failure(abort_code = registry::EAppNotAuthorized)]
fun create_trader_account_constructor_rejects_unauthorized_app() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let registry_id = create_registry_and_advance_scenario(&mut scenario, ADMIN_ADDRESS);

    test_scenario::next_tx(&mut scenario, ADMIN_ADDRESS);
    {
        let registry = take_registry_from_scenario(&scenario, registry_id);
        let (
            balance_manager,
            deposit_cap,
            withdraw_cap,
            trade_cap,
            trader_account,
            _,
        ) = executor::create_trader_account_components(
            &registry,
            OWNER_ADDRESS,
            test_scenario::ctx(&mut scenario),
        );

        transfer::public_share_object(balance_manager);
        return_caps_to_scenario(&scenario, deposit_cap, withdraw_cap, trade_cap);
        return_trader_account_to_scenario(&scenario, trader_account);
    };
    abort
}

// === PTB Flow Tests ===

/// Creates a trader account via PTB composition and verifies owned objects.
#[test]
fun create_trader_account_ptb_happy_path() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let (_registry_id, balance_manager_id) = prepare_authorized_registry_and_trader_account(
        &mut scenario,
        ADMIN_ADDRESS,
        OWNER_ADDRESS,
        true,
    );

    test_scenario::next_tx(&mut scenario, OWNER_ADDRESS);
    {
        let (
            trader_account,
            deposit_cap,
            withdraw_cap,
            trade_cap,
        ) = take_owner_side_trader_account_bundle(&scenario);
        let balance_manager = take_shared_balance_manager_from_scenario(
            &scenario,
            balance_manager_id,
        );

        assert_trader_account_matches_caps(
            &trader_account,
            object::id(&trade_cap),
            object::id(&deposit_cap),
            object::id(&withdraw_cap),
        );
        assert_eq!(balance_manager::owner(&balance_manager), OWNER_ADDRESS);

        return_shared_balance_manager_to_scenario(balance_manager);
        return_caps_to_scenario(&scenario, deposit_cap, withdraw_cap, trade_cap);
        return_trader_account_to_scenario(&scenario, trader_account);
    };

    test_scenario::end(scenario);
}

/// Rejects PTB-composed trader account creation when the app is not authorized.
#[test, expected_failure(abort_code = registry::EAppNotAuthorized)]
fun create_trader_account_ptb_rejects_unauthorized_app() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let registry_id = create_registry_and_advance_scenario(&mut scenario, ADMIN_ADDRESS);

    test_scenario::next_tx(&mut scenario, ADMIN_ADDRESS);
    {
        let registry = take_registry_from_scenario(&scenario, registry_id);
        let (
            balance_manager,
            deposit_cap,
            withdraw_cap,
            trade_cap,
            trader_account,
            _,
        ) = executor::create_trader_account_components(
            &registry,
            OWNER_ADDRESS,
            test_scenario::ctx(&mut scenario),
        );
        transfer::public_share_object(balance_manager);
        return_caps_to_scenario(&scenario, deposit_cap, withdraw_cap, trade_cap);
        return_trader_account_to_scenario(&scenario, trader_account);
    };
    abort
}

// === Registration Tests ===

/// Registers the balance manager and verifies registry membership.
#[test]
fun register_balance_manager_happy_path() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let (registry_id, balance_manager_id) = prepare_authorized_registry_and_trader_account(
        &mut scenario,
        ADMIN_ADDRESS,
        OWNER_ADDRESS,
        true,
    );

    test_scenario::next_tx(&mut scenario, OWNER_ADDRESS);
    {
        let mut registry = take_registry_from_scenario(&scenario, registry_id);
        let (trader_account, balance_manager) = take_trader_account_and_bound_balance_manager(
            &scenario,
            balance_manager_id,
        );

        executor::register_balance_manager(
            &trader_account,
            &balance_manager,
            &mut registry,
            test_scenario::ctx(&mut scenario),
        );
        let balance_manager_ids = registry::get_balance_manager_ids(
            &registry,
            OWNER_ADDRESS,
        );
        assert_eq!(vec_set::contains(&balance_manager_ids, &balance_manager_id), true);

        return_registry_to_scenario(registry);
        return_shared_balance_manager_to_scenario(balance_manager);
        return_trader_account_to_scenario(&scenario, trader_account);
    };

    test_scenario::end(scenario);
}

/// Re-registering the same balance manager keeps the registry idempotent.
#[test]
fun register_balance_manager_is_idempotent() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let (registry_id, balance_manager_id) = prepare_authorized_registry_and_trader_account(
        &mut scenario,
        ADMIN_ADDRESS,
        OWNER_ADDRESS,
        true,
    );

    test_scenario::next_tx(&mut scenario, OWNER_ADDRESS);
    {
        let mut registry = take_registry_from_scenario(&scenario, registry_id);
        let (trader_account, balance_manager) = take_trader_account_and_bound_balance_manager(
            &scenario,
            balance_manager_id,
        );

        executor::register_balance_manager(
            &trader_account,
            &balance_manager,
            &mut registry,
            test_scenario::ctx(&mut scenario),
        );
        executor::register_balance_manager(
            &trader_account,
            &balance_manager,
            &mut registry,
            test_scenario::ctx(&mut scenario),
        );

        let balance_manager_ids = registry::get_balance_manager_ids(
            &registry,
            OWNER_ADDRESS,
        );
        assert_eq!(vec_set::length(&balance_manager_ids), 1);
        assert_eq!(vec_set::contains(&balance_manager_ids, &balance_manager_id), true);

        return_registry_to_scenario(registry);
        return_shared_balance_manager_to_scenario(balance_manager);
        return_trader_account_to_scenario(&scenario, trader_account);
    };

    test_scenario::end(scenario);
}

/// Rejects registering when the balance manager map is missing.
#[test, expected_failure(abort_code = dynamic_field::EFieldDoesNotExist)]
fun register_balance_manager_rejects_missing_balance_manager_map() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let (registry_id, balance_manager_id) = prepare_authorized_registry_and_trader_account(
        &mut scenario,
        ADMIN_ADDRESS,
        OWNER_ADDRESS,
        false,
    );

    test_scenario::next_tx(&mut scenario, OWNER_ADDRESS);
    {
        let mut registry = take_registry_from_scenario(&scenario, registry_id);
        let (trader_account, balance_manager) = take_trader_account_and_bound_balance_manager(
            &scenario,
            balance_manager_id,
        );
        executor::register_balance_manager(
            &trader_account,
            &balance_manager,
            &mut registry,
            test_scenario::ctx(&mut scenario),
        );

        return_registry_to_scenario(registry);
        return_shared_balance_manager_to_scenario(balance_manager);
        return_trader_account_to_scenario(&scenario, trader_account);
    };
    abort
}

/// Rejects registering when the caller is not the owner.
#[test, expected_failure(abort_code = executor::ENotTraderAccountOwner)]
fun register_balance_manager_rejects_non_owner() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let (registry_id, balance_manager_id) = prepare_authorized_registry_and_trader_account(
        &mut scenario,
        ADMIN_ADDRESS,
        OWNER_ADDRESS,
        true,
    );

    test_scenario::next_tx(&mut scenario, OTHER_ADDRESS);
    {
        let mut registry = take_registry_from_scenario(&scenario, registry_id);
        let trader_account = test_scenario::take_from_address<executor::TraderAccount>(
            &scenario,
            OWNER_ADDRESS,
        );
        let balance_manager = take_shared_balance_manager_from_scenario(
            &scenario,
            balance_manager_id,
        );

        executor::register_balance_manager(
            &trader_account,
            &balance_manager,
            &mut registry,
            test_scenario::ctx(&mut scenario),
        );

        return_registry_to_scenario(registry);
        return_shared_balance_manager_to_scenario(balance_manager);
        executor::transfer_trader_account_to_owner(trader_account);
    };
    abort
}

/// Rejects registering when the balance manager does not match the account.
#[test, expected_failure(abort_code = executor::EBalanceManagerMismatch)]
fun register_balance_manager_rejects_mismatched_balance_manager() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let (registry_id, _balance_manager_id) = prepare_authorized_registry_and_trader_account(
        &mut scenario,
        ADMIN_ADDRESS,
        OWNER_ADDRESS,
        true,
    );

    test_scenario::next_tx(&mut scenario, OWNER_ADDRESS);
    {
        let mut registry = take_registry_from_scenario(&scenario, registry_id);
        let trader_account = take_trader_account_from_scenario(&scenario);
        let other_balance_manager = balance_manager::new(
            test_scenario::ctx(&mut scenario),
        );

        executor::register_balance_manager(
            &trader_account,
            &other_balance_manager,
            &mut registry,
            test_scenario::ctx(&mut scenario),
        );

        return_registry_to_scenario(registry);
        executor::transfer_trader_account_to_owner(trader_account);
        transfer::public_share_object(other_balance_manager);
    };
    abort
}
