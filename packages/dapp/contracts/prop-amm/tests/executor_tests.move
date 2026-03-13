/// Tests for AMM executor behavior.
#[test_only]
module openzeppelin_market_maker::executor_tests;

use deepbook::balance_manager::{
    Self as balance_manager,
    BalanceManager,
    DepositCap,
    TradeCap,
    WithdrawCap
};
use deepbook::registry::{Self as registry, Registry};
use openzeppelin_market_maker::executor::{Self, TraderAccount};
use std::unit_test::{assert_eq, destroy};
use sui::test_scenario;

public struct RetrievedTraderAccountBundle {
    trader_account: TraderAccount,
    deposit_cap: DepositCap,
    withdraw_cap: WithdrawCap,
    trade_cap: TradeCap,
    balance_manager: BalanceManager,
}

public struct CreatedTraderAccountComponents {
    balance_manager: BalanceManager,
    deposit_cap: DepositCap,
    withdraw_cap: WithdrawCap,
    trade_cap: TradeCap,
    trader_account: TraderAccount,
}

// === Helpers ===

fun begin_authorized_scenario(sender: address): test_scenario::Scenario {
    let mut scenario = test_scenario::begin(sender);
    create_authorized_registry(&mut scenario, sender);
    scenario
}

fun create_authorized_registry(scenario: &mut test_scenario::Scenario, sender: address) {
    scenario.next_tx(sender);
    registry::test_registry(scenario.ctx());

    scenario.next_tx(sender);
    let admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
    let mut deepbook_registry: Registry = test_scenario::take_shared(scenario);

    registry::authorize_app<executor::PropAmmApp>(&mut deepbook_registry, &admin_cap);
    registry::init_balance_manager_map(&mut deepbook_registry, &admin_cap, scenario.ctx());

    test_scenario::return_shared(deepbook_registry);
    destroy(admin_cap);
}

fun assert_owner_cap_ids_match(
    trader_account: &TraderAccount,
    trade_cap: &TradeCap,
    deposit_cap: &DepositCap,
    withdraw_cap: &WithdrawCap,
) {
    assert_eq!(executor::trade_cap_id(trader_account), object::id(trade_cap));
    assert_eq!(executor::deposit_cap_id(trader_account), object::id(deposit_cap));
    assert_eq!(executor::withdraw_cap_id(trader_account), object::id(withdraw_cap));
}

fun assert_registry_contains_expected_managers(
    deepbook_registry: &Registry,
    owner: address,
    expected_manager_ids: vector<ID>,
) {
    let registered_ids = registry::get_balance_manager_ids(deepbook_registry, owner);
    let mut index = 0;

    assert_eq!(registered_ids.length(), expected_manager_ids.length());
    while (index < expected_manager_ids.length()) {
        let expected_manager_id = expected_manager_ids[index];
        assert!(registered_ids.contains(&expected_manager_id), 0);
        index = index + 1;
    };
}

fun return_registry_and_share_balance_manager(
    deepbook_registry: Registry,
    balance_manager: BalanceManager,
) {
    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(balance_manager);
}

fun transfer_created_components_to_recipient(
    deposit_cap: DepositCap,
    withdraw_cap: WithdrawCap,
    trade_cap: TradeCap,
    trader_account: TraderAccount,
    recipient: address,
) {
    transfer::public_transfer(deposit_cap, recipient);
    transfer::public_transfer(withdraw_cap, recipient);
    transfer::public_transfer(trade_cap, recipient);
    executor::transfer_trader_account_for_testing(trader_account, recipient);
}

fun create_components_for_owner(
    deepbook_registry: &Registry,
    owner: address,
    scenario: &mut test_scenario::Scenario,
): CreatedTraderAccountComponents {
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    ) = executor::create_trader_account_components(
        deepbook_registry,
        owner,
        scenario.ctx(),
    );

    CreatedTraderAccountComponents {
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    }
}

fun take_retrieved_trader_account_bundle(
    scenario: &test_scenario::Scenario,
): RetrievedTraderAccountBundle {
    RetrievedTraderAccountBundle {
        trader_account: test_scenario::take_from_sender(scenario),
        deposit_cap: test_scenario::take_from_sender(scenario),
        withdraw_cap: test_scenario::take_from_sender(scenario),
        trade_cap: test_scenario::take_from_sender(scenario),
        balance_manager: test_scenario::take_shared(scenario),
    }
}

fun return_retrieved_trader_account_bundle(
    scenario: &test_scenario::Scenario,
    retrieved_bundle: RetrievedTraderAccountBundle,
) {
    let RetrievedTraderAccountBundle {
        trader_account,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        balance_manager,
    } = retrieved_bundle;

    test_scenario::return_to_sender(scenario, trader_account);
    test_scenario::return_to_sender(scenario, deposit_cap);
    test_scenario::return_to_sender(scenario, withdraw_cap);
    test_scenario::return_to_sender(scenario, trade_cap);
    test_scenario::return_shared(balance_manager);
}

// === Tests ===

#[test]
fun ai_create_trader_account_components_supports_custom_owner() {
    let sender = @0xA;
    let owner = @0xB;
    let mut scenario = begin_authorized_scenario(sender);

    scenario.next_tx(sender);
    let deepbook_registry: Registry = test_scenario::take_shared(&scenario);
    let CreatedTraderAccountComponents {
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        owner,
        &mut scenario,
    );

    assert_eq!(executor::owner(&trader_account), owner);
    assert_eq!(
        executor::balance_manager_id(&trader_account),
        balance_manager::id(&balance_manager),
    );
    assert_owner_cap_ids_match(&trader_account, &trade_cap, &deposit_cap, &withdraw_cap);

    return_registry_and_share_balance_manager(deepbook_registry, balance_manager);
    transfer_created_components_to_recipient(
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
        owner,
    );
    test_scenario::end(scenario);
}

#[test]
fun ai_create_trader_account_with_shared_manager_transfers_account_and_caps() {
    let sender = @0xC;
    let mut scenario = begin_authorized_scenario(sender);

    scenario.next_tx(sender);
    let deepbook_registry: Registry = test_scenario::take_shared(&scenario);
    executor::create_trader_account_with_shared_manager_and_owner_caps(
        &deepbook_registry,
        sender,
        scenario.ctx(),
    );
    test_scenario::return_shared(deepbook_registry);

    scenario.next_tx(sender);
    let RetrievedTraderAccountBundle {
        trader_account,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        balance_manager,
    } = take_retrieved_trader_account_bundle(&scenario);

    assert_eq!(executor::owner(&trader_account), sender);
    assert_eq!(
        executor::balance_manager_id(&trader_account),
        balance_manager::id(&balance_manager),
    );
    assert_owner_cap_ids_match(&trader_account, &trade_cap, &deposit_cap, &withdraw_cap);

    return_retrieved_trader_account_bundle(
        &scenario,
        RetrievedTraderAccountBundle {
            trader_account,
            deposit_cap,
            withdraw_cap,
            trade_cap,
            balance_manager,
        },
    );
    test_scenario::end(scenario);
}

#[test]
fun ai_register_balance_manager_registers_matching_owner_manager_pair() {
    let sender = @0xD;
    let mut scenario = begin_authorized_scenario(sender);

    scenario.next_tx(sender);
    let mut deepbook_registry: Registry = test_scenario::take_shared(&scenario);
    let CreatedTraderAccountComponents {
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        sender,
        &mut scenario,
    );

    executor::register_balance_manager(
        &trader_account,
        &balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    assert_registry_contains_expected_managers(
        &deepbook_registry,
        sender,
        vector[balance_manager::id(&balance_manager)],
    );

    return_registry_and_share_balance_manager(deepbook_registry, balance_manager);
    transfer_created_components_to_recipient(
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
        sender,
    );
    test_scenario::end(scenario);
}

#[test]
fun ai_register_balance_manager_is_idempotent_for_same_manager() {
    let sender = @0xE;
    let mut scenario = begin_authorized_scenario(sender);

    scenario.next_tx(sender);
    let mut deepbook_registry: Registry = test_scenario::take_shared(&scenario);
    let CreatedTraderAccountComponents {
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        sender,
        &mut scenario,
    );

    executor::register_balance_manager(
        &trader_account,
        &balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );
    executor::register_balance_manager(
        &trader_account,
        &balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    assert_registry_contains_expected_managers(
        &deepbook_registry,
        sender,
        vector[balance_manager::id(&balance_manager)],
    );

    return_registry_and_share_balance_manager(deepbook_registry, balance_manager);
    transfer_created_components_to_recipient(
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
        sender,
    );
    test_scenario::end(scenario);
}

#[test]
fun ai_register_balance_manager_supports_custom_owner_after_component_transfer() {
    let creator = @0x12;
    let owner = @0x13;
    let mut scenario = begin_authorized_scenario(creator);

    scenario.next_tx(creator);
    let deepbook_registry: Registry = test_scenario::take_shared(&scenario);
    let CreatedTraderAccountComponents {
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        owner,
        &mut scenario,
    );
    let balance_manager_id = balance_manager::id(&balance_manager);

    return_registry_and_share_balance_manager(deepbook_registry, balance_manager);
    transfer_created_components_to_recipient(
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
        owner,
    );

    scenario.next_tx(owner);
    let RetrievedTraderAccountBundle {
        trader_account,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        balance_manager,
    } = take_retrieved_trader_account_bundle(&scenario);
    let mut deepbook_registry: Registry = test_scenario::take_shared(&scenario);

    executor::register_balance_manager(
        &trader_account,
        &balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    assert_registry_contains_expected_managers(
        &deepbook_registry,
        owner,
        vector[balance_manager_id],
    );

    return_retrieved_trader_account_bundle(
        &scenario,
        RetrievedTraderAccountBundle {
            trader_account,
            deposit_cap,
            withdraw_cap,
            trade_cap,
            balance_manager,
        },
    );
    test_scenario::return_shared(deepbook_registry);
    test_scenario::end(scenario);
}

#[test]
fun ai_register_balance_manager_tracks_distinct_managers_for_same_owner() {
    let sender = @0x14;
    let mut scenario = begin_authorized_scenario(sender);

    scenario.next_tx(sender);
    let mut deepbook_registry: Registry = test_scenario::take_shared(&scenario);
    let CreatedTraderAccountComponents {
        balance_manager: first_balance_manager,
        deposit_cap: first_deposit_cap,
        withdraw_cap: first_withdraw_cap,
        trade_cap: first_trade_cap,
        trader_account: first_trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        sender,
        &mut scenario,
    );
    let CreatedTraderAccountComponents {
        balance_manager: second_balance_manager,
        deposit_cap: second_deposit_cap,
        withdraw_cap: second_withdraw_cap,
        trade_cap: second_trade_cap,
        trader_account: second_trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        sender,
        &mut scenario,
    );

    executor::register_balance_manager(
        &first_trader_account,
        &first_balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );
    executor::register_balance_manager(
        &second_trader_account,
        &second_balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    assert_registry_contains_expected_managers(
        &deepbook_registry,
        sender,
        vector[
            balance_manager::id(&first_balance_manager),
            balance_manager::id(&second_balance_manager),
        ],
    );

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(first_balance_manager);
    transfer::public_transfer(first_deposit_cap, sender);
    transfer::public_transfer(first_withdraw_cap, sender);
    transfer::public_transfer(first_trade_cap, sender);
    executor::transfer_trader_account_for_testing(first_trader_account, sender);
    transfer::public_share_object(second_balance_manager);
    transfer::public_transfer(second_deposit_cap, sender);
    transfer::public_transfer(second_withdraw_cap, sender);
    transfer::public_transfer(second_trade_cap, sender);
    executor::transfer_trader_account_for_testing(second_trader_account, sender);
    test_scenario::end(scenario);
}

#[test, expected_failure(abort_code = executor::ENotTraderAccountOwner)]
fun ai_register_balance_manager_rejects_non_owner_sender() {
    let owner = @0xF;
    let intruder = @0x10;
    let mut scenario = begin_authorized_scenario(owner);

    scenario.next_tx(owner);
    let deepbook_registry: Registry = test_scenario::take_shared(&scenario);
    let CreatedTraderAccountComponents {
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        owner,
        &mut scenario,
    );

    return_registry_and_share_balance_manager(deepbook_registry, balance_manager);
    transfer_created_components_to_recipient(
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
        intruder,
    );

    scenario.next_tx(intruder);
    let trader_account: TraderAccount = test_scenario::take_from_sender(&scenario);
    let balance_manager: BalanceManager = test_scenario::take_shared(&scenario);
    let mut deepbook_registry: Registry = test_scenario::take_shared(&scenario);

    executor::register_balance_manager(
        &trader_account,
        &balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = executor::EBalanceManagerMismatch)]
fun ai_register_balance_manager_rejects_mismatched_balance_manager() {
    let sender = @0x11;
    let mut scenario = begin_authorized_scenario(sender);

    scenario.next_tx(sender);
    let mut deepbook_registry: Registry = test_scenario::take_shared(&scenario);
    let CreatedTraderAccountComponents {
        balance_manager: matching_balance_manager,
        deposit_cap: _matching_deposit_cap,
        withdraw_cap: _matching_withdraw_cap,
        trade_cap: _matching_trade_cap,
        trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        sender,
        &mut scenario,
    );
    let CreatedTraderAccountComponents {
        balance_manager: mismatched_balance_manager,
        deposit_cap: _mismatched_deposit_cap,
        withdraw_cap: _mismatched_withdraw_cap,
        trade_cap: _mismatched_trade_cap,
        trader_account: _mismatched_trader_account,
    } = create_components_for_owner(
        &deepbook_registry,
        sender,
        &mut scenario,
    );

    executor::register_balance_manager(
        &trader_account,
        &mismatched_balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    transfer::public_share_object(matching_balance_manager);
    abort
}
