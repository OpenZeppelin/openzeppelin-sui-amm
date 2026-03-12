/// Tests for AMM executor behavior.
#[test_only]
module openzeppelin_market_maker::executor_tests;

use deepbook::balance_manager::{Self, BalanceManager};
use deepbook::registry::{Self, Registry};
use openzeppelin_market_maker::executor::{Self, PropAmmApp, TraderAccount};
use std::unit_test::{assert_eq, destroy};
use sui::test_scenario;
use sui::vec_set;

const ADMIN_ADDRESS: address = @0xA;
const OWNER_ADDRESS: address = @0xB;
const OTHER_ADDRESS: address = @0xC;

fun create_registry(scenario: &mut test_scenario::Scenario): ID {
    scenario.next_tx(ADMIN_ADDRESS);
    registry::test_registry(scenario.ctx())
}

fun authorize_app_and_init_balance_manager_map(
    scenario: &mut test_scenario::Scenario,
    registry_id: ID,
) {
    scenario.next_tx(ADMIN_ADDRESS);

    let mut registry: Registry = scenario.take_shared_by_id(registry_id);
    let admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());

    registry.authorize_app<PropAmmApp>(&admin_cap);
    registry.init_balance_manager_map(&admin_cap, scenario.ctx());

    test_scenario::return_shared(registry);
    destroy(admin_cap);
}

fun create_and_publish_trader_account(
    scenario: &mut test_scenario::Scenario,
    registry_id: ID,
    owner: address,
): ID {
    scenario.next_tx(ADMIN_ADDRESS);

    let registry: Registry = scenario.take_shared_by_id(registry_id);
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    ) = executor::create_trader_account_components(
        &registry,
        owner,
        scenario.ctx(),
    );

    let balance_manager_id = balance_manager.id();
    transfer::public_transfer(deposit_cap, owner);
    transfer::public_transfer(withdraw_cap, owner);
    transfer::public_transfer(trade_cap, owner);
    transfer::transfer(trader_account, owner);
    transfer::public_share_object(balance_manager);
    test_scenario::return_shared(registry);

    balance_manager_id
}

#[test]
fun create_trader_account_components_happy_path() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let registry_id = create_registry(&mut scenario);
    authorize_app_and_init_balance_manager_map(&mut scenario, registry_id);

    scenario.next_tx(ADMIN_ADDRESS);

    let registry: Registry = scenario.take_shared_by_id(registry_id);
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    ) = executor::create_trader_account_components(
        &registry,
        OWNER_ADDRESS,
        scenario.ctx(),
    );

    assert_eq!(trader_account.owner(), OWNER_ADDRESS);
    assert_eq!(trader_account.balance_manager_id(), balance_manager.id());
    assert_eq!(trader_account.trade_cap_id(), option::some(object::id(&trade_cap)));
    assert_eq!(trader_account.deposit_cap_id(), option::some(object::id(&deposit_cap)));
    assert_eq!(trader_account.withdraw_cap_id(), option::some(object::id(&withdraw_cap)));

    transfer::public_transfer(deposit_cap, OWNER_ADDRESS);
    transfer::public_transfer(withdraw_cap, OWNER_ADDRESS);
    transfer::public_transfer(trade_cap, OWNER_ADDRESS);
    transfer::transfer(trader_account, OWNER_ADDRESS);
    transfer::public_share_object(balance_manager);
    test_scenario::return_shared(registry);

    test_scenario::end(scenario);
}

#[test, expected_failure(abort_code = registry::EAppNotAuthorized)]
fun create_trader_account_components_rejects_unauthorized_app() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let registry_id = create_registry(&mut scenario);

    scenario.next_tx(ADMIN_ADDRESS);

    let registry: Registry = scenario.take_shared_by_id(registry_id);
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    ) = executor::create_trader_account_components(
        &registry,
        OWNER_ADDRESS,
        scenario.ctx(),
    );

    // This path should abort before here, but if it doesn't, clean up resources.
    transfer::public_transfer(deposit_cap, OWNER_ADDRESS);
    transfer::public_transfer(withdraw_cap, OWNER_ADDRESS);
    transfer::public_transfer(trade_cap, OWNER_ADDRESS);
    transfer::transfer(trader_account, OWNER_ADDRESS);
    transfer::public_share_object(balance_manager);
    test_scenario::return_shared(registry);

    abort
}

#[test]
fun register_balance_manager_happy_path() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let registry_id = create_registry(&mut scenario);
    authorize_app_and_init_balance_manager_map(&mut scenario, registry_id);
    let balance_manager_id = create_and_publish_trader_account(
        &mut scenario,
        registry_id,
        OWNER_ADDRESS,
    );

    scenario.next_tx(OWNER_ADDRESS);

    let mut registry: Registry = scenario.take_shared_by_id(registry_id);
    let trader_account: TraderAccount = scenario.take_from_sender();
    let balance_manager: BalanceManager = scenario.take_shared_by_id(balance_manager_id);

    trader_account.register_balance_manager(
        &balance_manager,
        &mut registry,
        scenario.ctx(),
    );

    let balance_manager_ids = registry.get_balance_manager_ids(OWNER_ADDRESS);
    assert_eq!(vec_set::contains(&balance_manager_ids, &balance_manager_id), true);

    test_scenario::return_shared(registry);
    test_scenario::return_shared(balance_manager);
    scenario.return_to_sender(trader_account);

    test_scenario::end(scenario);
}

#[test, expected_failure(abort_code = executor::ENotTraderAccountOwner)]
fun register_balance_manager_rejects_non_owner() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let registry_id = create_registry(&mut scenario);
    authorize_app_and_init_balance_manager_map(&mut scenario, registry_id);
    let balance_manager_id = create_and_publish_trader_account(
        &mut scenario,
        registry_id,
        OWNER_ADDRESS,
    );

    scenario.next_tx(OWNER_ADDRESS);

    let trader_account: TraderAccount = scenario.take_from_sender();
    transfer::transfer(trader_account, OTHER_ADDRESS);

    scenario.next_tx(OTHER_ADDRESS);

    let mut registry: Registry = scenario.take_shared_by_id(registry_id);
    let trader_account: TraderAccount = scenario.take_from_sender();
    let balance_manager: BalanceManager = scenario.take_shared_by_id(balance_manager_id);

    trader_account.register_balance_manager(
        &balance_manager,
        &mut registry,
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = executor::EBalanceManagerMismatch)]
fun register_balance_manager_rejects_mismatched_balance_manager() {
    let mut scenario = test_scenario::begin(ADMIN_ADDRESS);
    let registry_id = create_registry(&mut scenario);
    authorize_app_and_init_balance_manager_map(&mut scenario, registry_id);
    let _balance_manager_id = create_and_publish_trader_account(
        &mut scenario,
        registry_id,
        OWNER_ADDRESS,
    );

    scenario.next_tx(OWNER_ADDRESS);

    let mut registry: Registry = scenario.take_shared_by_id(registry_id);
    let trader_account: TraderAccount = scenario.take_from_sender();
    let other_balance_manager = balance_manager::new(scenario.ctx());

    trader_account.register_balance_manager(
        &other_balance_manager,
        &mut registry,
        scenario.ctx(),
    );

    abort
}
