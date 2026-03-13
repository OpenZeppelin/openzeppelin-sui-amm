/// Tests for AMM executor behavior.
#[test_only]
module openzeppelin_market_maker::executor_tests;

use deepbook::balance_manager::{Self, BalanceManager, DepositCap, TradeCap, WithdrawCap};
use deepbook::registry::{Self, Registry};
use openzeppelin_market_maker::executor::{Self, TraderAccount};
use std::unit_test::{assert_eq, destroy};
use sui::test_scenario;

// === Helpers ===

fun create_authorized_registry(scenario: &mut test_scenario::Scenario, sender: address) {
    scenario.next_tx(sender);
    registry::test_registry(scenario.ctx());

    scenario.next_tx(sender);

    let admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
    let mut deepbook_registry: Registry = scenario.take_shared();
    deepbook_registry.authorize_app<executor::PropAmmApp>(&admin_cap);
    deepbook_registry.init_balance_manager_map(&admin_cap, scenario.ctx());

    test_scenario::return_shared(deepbook_registry);
    destroy(admin_cap);
}

#[test]
fun create_trader_account_supports_custom_owner() {
    let sender = @0xA;
    let owner = @0xB;
    let mut scenario = test_scenario::begin(sender);

    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let deepbook_registry: Registry = scenario.take_shared();
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    ) = executor::create_trader_account(
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );

    assert_eq!(trader_account.owner(), owner);
    assert_eq!(trader_account.balance_manager_id(), balance_manager::id(&balance_manager));
    assert_eq!(trader_account.trade_cap_id(), object::id(&trade_cap));
    assert_eq!(trader_account.deposit_cap_id(), object::id(&deposit_cap));
    assert_eq!(trader_account.withdraw_cap_id(), object::id(&withdraw_cap));

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(balance_manager);
    transfer::public_transfer(deposit_cap, owner);
    transfer::public_transfer(withdraw_cap, owner);
    transfer::public_transfer(trade_cap, owner);
    transfer::public_transfer(trader_account, owner);
    scenario.end();
}

#[test]
fun create_trader_account_with_shared_manager_transfers_account_and_caps() {
    let sender = @0xC;
    let mut scenario = test_scenario::begin(sender);

    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);
    let deepbook_registry: Registry = scenario.take_shared();
    executor::create_trader_account_with_shared_manager_and_owner_caps(
        &deepbook_registry,
        sender,
        scenario.ctx(),
    );
    test_scenario::return_shared(deepbook_registry);

    scenario.next_tx(sender);
    let trader_account: TraderAccount = scenario.take_from_sender();
    let deposit_cap: DepositCap = scenario.take_from_sender();
    let withdraw_cap: WithdrawCap = scenario.take_from_sender();
    let trade_cap: TradeCap = scenario.take_from_sender();
    let balance_manager: BalanceManager = scenario.take_shared();

    assert_eq!(trader_account.owner(), sender);
    assert_eq!(trader_account.balance_manager_id(), balance_manager::id(&balance_manager));
    assert_eq!(trader_account.trade_cap_id(), object::id(&trade_cap));
    assert_eq!(trader_account.deposit_cap_id(), object::id(&deposit_cap));
    assert_eq!(trader_account.withdraw_cap_id(), object::id(&withdraw_cap));

    scenario.return_to_sender(trader_account);
    scenario.return_to_sender(deposit_cap);
    scenario.return_to_sender(withdraw_cap);
    scenario.return_to_sender(trade_cap);
    test_scenario::return_shared(balance_manager);
    scenario.end();
}

#[test]
fun register_balance_manager_registers_matching_owner_manager_pair() {
    let sender = @0xD;
    let mut scenario = test_scenario::begin(sender);

    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let mut deepbook_registry: Registry = scenario.take_shared();
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    ) = executor::create_trader_account(
        &deepbook_registry,
        sender,
        scenario.ctx(),
    );

    balance_manager.register_balance_manager(
        &mut deepbook_registry,
        scenario.ctx(),
    );

    let manager_ids = deepbook_registry.get_balance_manager_ids(sender);
    assert!(manager_ids.contains(&balance_manager.id()));

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(balance_manager);
    transfer::public_transfer(deposit_cap, sender);
    transfer::public_transfer(withdraw_cap, sender);
    transfer::public_transfer(trade_cap, sender);
    transfer::public_transfer(trader_account, sender);
    scenario.end();
}

#[test]
fun register_balance_manager_is_idempotent_for_same_manager() {
    let sender = @0xE;
    let mut scenario = test_scenario::begin(sender);

    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let mut deepbook_registry: Registry = scenario.take_shared();
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    ) = executor::create_trader_account(
        &deepbook_registry,
        sender,
        scenario.ctx(),
    );

    trader_account.register_balance_manager(
        &balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );
    trader_account.register_balance_manager(
        &balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    let manager_ids = deepbook_registry.get_balance_manager_ids(sender);
    assert!(manager_ids.contains(&balance_manager.id()));

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(balance_manager);
    transfer::public_transfer(deposit_cap, sender);
    transfer::public_transfer(withdraw_cap, sender);
    transfer::public_transfer(trade_cap, sender);
    transfer::public_transfer(trader_account, sender);

    scenario.end();
}

#[test, expected_failure(abort_code = executor::ENotTraderAccountOwner)]
fun register_balance_manager_rejects_non_owner_sender() {
    let owner = @0xF;
    let intruder = @0x10;
    let mut scenario = test_scenario::begin(owner);

    create_authorized_registry(&mut scenario, owner);

    scenario.next_tx(owner);

    let deepbook_registry: Registry = scenario.take_shared();
    let (
        balance_manager,
        deposit_cap,
        withdraw_cap,
        trade_cap,
        trader_account,
    ) = executor::create_trader_account(
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(balance_manager);
    transfer::public_transfer(deposit_cap, owner);
    transfer::public_transfer(withdraw_cap, owner);
    transfer::public_transfer(trade_cap, owner);
    transfer::public_transfer(trader_account, intruder);

    scenario.next_tx(intruder);

    let trader_account: TraderAccount = scenario.take_from_sender();
    let balance_manager: BalanceManager = scenario.take_shared();
    let mut deepbook_registry: Registry = scenario.take_shared();

    trader_account.register_balance_manager(
        &balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = executor::EBalanceManagerMismatch)]
fun register_balance_manager_rejects_mismatched_balance_manager() {
    let sender = @0x11;
    let mut scenario = test_scenario::begin(sender);

    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let mut deepbook_registry: Registry = scenario.take_shared();
    let (
        matching_balance_manager,
        _matching_deposit_cap,
        _matching_withdraw_cap,
        _matching_trade_cap,
        trader_account,
    ) = executor::create_trader_account(
        &deepbook_registry,
        sender,
        scenario.ctx(),
    );
    let (
        mismatched_balance_manager,
        _mismatched_deposit_cap,
        _mismatched_withdraw_cap,
        _mismatched_trade_cap,
        _mismatched_trader_account,
    ) = executor::create_trader_account(
        &deepbook_registry,
        sender,
        scenario.ctx(),
    );

    trader_account.register_balance_manager(
        &mismatched_balance_manager,
        &mut deepbook_registry,
        scenario.ctx(),
    );

    transfer::public_share_object(matching_balance_manager);

    abort
}
