/// Tests for AMM executor behavior.
#[test_only]
module openzeppelin_market_maker::executor_tests;

use deepbook::balance_manager::{Self, BalanceManager};
use deepbook::registry::{Self, Registry};
use openzeppelin_market_maker::events::trader_account_created;
use openzeppelin_market_maker::executor::{Self, TraderAccount};
use openzeppelin_market_maker::manager::{Self, AMMAdminCap};
use openzeppelin_market_maker::test_helpers::assert_emitted;
use std::unit_test::{assert_eq, destroy};
use sui::coin::mint_for_testing;
use sui::sui::SUI;
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
fun create_trader_account_sets_owner_and_emits_created_event() {
    let sender = @0xA;
    let owner = @0xB;
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let deepbook_registry: Registry = scenario.take_shared();
    let trader_account = executor::create_trader_account(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    assert_emitted!(trader_account_created(trader_account.trader_account_id()));

    assert_eq!(trader_account.owner(), owner);
    assert_eq!(trader_account.trader_account_id(), object::id(&trader_account));

    let balance_manager = trader_account.balance_manager();
    assert_eq!(balance_manager::id(balance_manager), balance_manager::id(balance_manager));

    test_scenario::return_shared(deepbook_registry);
    test_scenario::return_to_sender(&scenario, admin_cap);
    transfer::public_transfer(trader_account, owner);
    scenario.end();
}

#[test]
fun create_trader_account_and_transfer_moves_account_to_owner() {
    let sender = @0xC;
    let owner = @0xD;
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);
    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let deepbook_registry: Registry = scenario.take_shared();
    let trader_account_id = executor::create_trader_account_and_transfer(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    assert_emitted!(trader_account_created(trader_account_id));

    test_scenario::return_shared(deepbook_registry);
    test_scenario::return_to_sender(&scenario, admin_cap);

    scenario.next_tx(owner);
    let trader_account: TraderAccount = scenario.take_from_sender();
    assert_eq!(trader_account.owner(), owner);
    assert_eq!(trader_account.trader_account_id(), trader_account_id);
    test_scenario::return_to_sender(&scenario, trader_account);

    scenario.end();
}

#[test]
fun create_trader_account_creates_distinct_accounts_for_same_owner() {
    let sender = @0xE;
    let owner = @0xF;
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let deepbook_registry: Registry = scenario.take_shared();

    let trader_account_a = executor::create_trader_account(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    let trader_account_b = executor::create_trader_account(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );

    assert!(trader_account_a.trader_account_id() != trader_account_b.trader_account_id());
    assert!(trader_account_a.trade_cap_id() != trader_account_b.trade_cap_id());
    assert!(trader_account_a.deposit_cap_id() != trader_account_b.deposit_cap_id());
    assert!(trader_account_a.withdraw_cap_id() != trader_account_b.withdraw_cap_id());

    let balance_manager_a = trader_account_a.balance_manager();
    let balance_manager_b = trader_account_b.balance_manager();
    assert!(balance_manager::id(balance_manager_a) != balance_manager::id(balance_manager_b));

    test_scenario::return_shared(deepbook_registry);
    test_scenario::return_to_sender(&scenario, admin_cap);
    transfer::public_transfer(trader_account_a, owner);
    transfer::public_transfer(trader_account_b, owner);

    scenario.end();
}

#[test]
fun create_trader_account_and_transfer_supports_multiple_accounts_for_owner() {
    let sender = @0x10;
    let owner = @0x11;
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let deepbook_registry: Registry = scenario.take_shared();
    let trader_account_id_a = executor::create_trader_account_and_transfer(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    let trader_account_id_b = executor::create_trader_account_and_transfer(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );

    assert!(trader_account_id_a != trader_account_id_b);

    test_scenario::return_shared(deepbook_registry);
    test_scenario::return_to_sender(&scenario, admin_cap);

    scenario.next_tx(owner);
    let trader_account_a: TraderAccount = scenario.take_from_sender();
    let trader_account_b: TraderAccount = scenario.take_from_sender();

    let id_a = trader_account_a.trader_account_id();
    let id_b = trader_account_b.trader_account_id();
    assert!(
        (id_a == trader_account_id_a && id_b == trader_account_id_b)
        || (id_a == trader_account_id_b && id_b == trader_account_id_a),
    );

    test_scenario::return_to_sender(&scenario, trader_account_a);
    test_scenario::return_to_sender(&scenario, trader_account_b);

    scenario.end();
}

#[test]
fun withdraw_trader_account_with_matching_balance_manager() {
    let sender = @0x16;
    let deposit_amount = 100;
    let withdraw_amount = 40;
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
        sender,
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(balance_manager);
    transfer::public_transfer(deposit_cap, sender);
    transfer::public_transfer(withdraw_cap, sender);
    transfer::public_transfer(trade_cap, sender);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);

    let trader_account: TraderAccount = scenario.take_from_sender();
    let mut balance_manager: BalanceManager = scenario.take_shared();

    trader_account.fund_trader_account(
        &mut balance_manager,
        mint_for_testing<SUI>(
            deposit_amount,
            scenario.ctx(),
        ),
        scenario.ctx(),
    );
    let withdrawn_coin = trader_account.withdraw_trader_account<SUI>(
        &mut balance_manager,
        withdraw_amount,
        scenario.ctx(),
    );

    assert_eq!(balance_manager.balance<SUI>(), deposit_amount - withdraw_amount);
    assert_eq!(withdrawn_coin.value(), withdraw_amount);
    assert_eq!(withdrawn_coin.burn_for_testing(), withdraw_amount);

    scenario.return_to_sender(trader_account);
    test_scenario::return_shared(balance_manager);
    scenario.end();
}

#[test, expected_failure(abort_code = balance_manager::EBalanceManagerBalanceTooLow)]
fun withdraw_trader_account_rejects_insufficient_balance() {
    let sender = @0x17;
    let deposit_amount = 10;
    let withdraw_amount = 20;
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
        sender,
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(balance_manager);
    transfer::public_transfer(deposit_cap, sender);
    transfer::public_transfer(withdraw_cap, sender);
    transfer::public_transfer(trade_cap, sender);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);

    let trader_account: TraderAccount = scenario.take_from_sender();
    let mut balance_manager: BalanceManager = scenario.take_shared();
    trader_account.fund_trader_account(
        &mut balance_manager,
        mint_for_testing<SUI>(
            deposit_amount,
            scenario.ctx(),
        ),
        scenario.ctx(),
    );

    let withdrawn_coin = trader_account.withdraw_trader_account<SUI>(
        &mut balance_manager,
        withdraw_amount,
        scenario.ctx(),
    );
    withdrawn_coin.burn_for_testing();

    abort
}

#[test, expected_failure(abort_code = executor::EInvalidWithdrawAmount)]
fun withdraw_trader_account_rejects_zero_amount() {
    let sender = @0x1B;
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
        sender,
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(balance_manager);
    transfer::public_transfer(deposit_cap, sender);
    transfer::public_transfer(withdraw_cap, sender);
    transfer::public_transfer(trade_cap, sender);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);

    let trader_account: TraderAccount = scenario.take_from_sender();
    let mut balance_manager: BalanceManager = scenario.take_shared();
    let withdrawn_coin = trader_account.withdraw_trader_account<SUI>(
        &mut balance_manager,
        0,
        scenario.ctx(),
    );
    withdrawn_coin.burn_for_testing();

    abort
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

#[test, expected_failure(abort_code = executor::ENotTraderAccountOwner)]
fun fund_trader_account_rejects_non_owner_sender() {
    let owner = @0x13;
    let intruder = @0x14;
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
    let mut balance_manager: BalanceManager = scenario.take_shared();

    trader_account.fund_trader_account(
        &mut balance_manager,
        mint_for_testing<SUI>(1, scenario.ctx()),
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = executor::ENotTraderAccountOwner)]
fun withdraw_trader_account_rejects_non_owner_sender() {
    let owner = @0x18;
    let intruder = @0x19;
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
    let mut balance_manager: BalanceManager = scenario.take_shared();

    let withdrawn_coin = trader_account.withdraw_trader_account<SUI>(
        &mut balance_manager,
        1,
        scenario.ctx(),
    );
    withdrawn_coin.burn_for_testing();

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

#[test, expected_failure(abort_code = executor::EBalanceManagerMismatch)]
fun fund_trader_account_rejects_mismatched_balance_manager() {
    let sender = @0x15;
    let mut scenario = test_scenario::begin(sender);

    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let deepbook_registry: Registry = scenario.take_shared();
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

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(matching_balance_manager);
    transfer::public_share_object(mismatched_balance_manager);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);

    let trader_account: TraderAccount = scenario.take_from_sender();
    let mut mismatched_balance_manager: BalanceManager = scenario.take_shared();

    trader_account.fund_trader_account(
        &mut mismatched_balance_manager,
        mint_for_testing<SUI>(1, scenario.ctx()),
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = executor::EBalanceManagerMismatch)]
fun withdraw_trader_account_rejects_mismatched_balance_manager() {
    let sender = @0x1A;
    let mut scenario = test_scenario::begin(sender);

    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let deepbook_registry: Registry = scenario.take_shared();
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

    test_scenario::return_shared(deepbook_registry);
    transfer::public_share_object(matching_balance_manager);
    transfer::public_share_object(mismatched_balance_manager);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);

    let trader_account: TraderAccount = scenario.take_from_sender();
    let mut mismatched_balance_manager: BalanceManager = scenario.take_shared();
    let withdrawn_coin = trader_account.withdraw_trader_account<SUI>(
        &mut mismatched_balance_manager,
        1,
        scenario.ctx(),
    );
    withdrawn_coin.burn_for_testing();

    abort
}
