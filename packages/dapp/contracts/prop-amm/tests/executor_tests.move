/// Tests for AMM executor behavior.
#[test_only]
module openzeppelin_market_maker::executor_tests;

use deepbook::balance_manager;
use deepbook::constants;
use deepbook::order_info::{OrderFilled, OrderFullyFilled};
use deepbook::pool::{Self, Pool};
use deepbook::registry::{Self, Registry};
use openzeppelin_market_maker::events::{quote_updated, trader_account_created};
use openzeppelin_market_maker::executor::{Self, TraderAccount};
use openzeppelin_market_maker::manager::{Self, AMMAdminCap, AMMConfig};
use openzeppelin_market_maker::test_helpers::{assert_emitted, build_pyth_price_feed_id};
use std::unit_test::{assert_eq, destroy};
use sui::clock::{Self, Clock};
use sui::coin::{Self, mint_for_testing};
use sui::event;
use sui::sui::SUI;
use sui::test_scenario;

// === Structs ===

public struct USDC has store {}

// === Test-Only Helpers ===

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
    let trader_account = executor::create_trader_account_for_owner(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    assert_emitted!(trader_account_created(trader_account.trader_account_id()));

    assert_eq!(trader_account.owner(), owner);
    assert_eq!(trader_account.trader_account_id(), object::id(&trader_account));

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
    let trader_account = executor::create_trader_account_for_owner(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    let trader_account_id = object::id(&trader_account);
    transfer::public_transfer(trader_account, owner);
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

    let trader_account_a = executor::create_trader_account_for_owner(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    let trader_account_b = executor::create_trader_account_for_owner(
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
    assert!(balance_manager_a.id() != balance_manager_b.id());

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
    let trader_account_a = executor::create_trader_account_for_owner(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    let trader_account_id_a = object::id(&trader_account_a);
    transfer::public_transfer(trader_account_a, owner);

    let trader_account_b = executor::create_trader_account_for_owner(
        &admin_cap,
        &deepbook_registry,
        owner,
        scenario.ctx(),
    );
    let trader_account_id_b = object::id(&trader_account_b);
    transfer::public_transfer(trader_account_b, owner);

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
fun deposit_and_withdraw_updates_trader_balance() {
    let sender = @0x12;
    let deposit_amount = 50 * constants::float_scaling();
    let withdraw_amount = 15 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let deepbook_registry: Registry = scenario.take_shared();
    let mut trader_account = executor::create_trader_account(
        &admin_cap,
        &deepbook_registry,
        scenario.ctx(),
    );

    trader_account.deposit(
        &admin_cap,
        mint_for_testing<SUI>(deposit_amount, scenario.ctx()),
        scenario.ctx(),
    );
    let withdrawn_coin = trader_account.withdraw<SUI>(
        &admin_cap,
        withdraw_amount,
        scenario.ctx(),
    );

    assert_eq!(withdrawn_coin.value(), withdraw_amount);
    assert_eq!(trader_account.balance_manager().balance<SUI>(), deposit_amount - withdraw_amount);

    coin::burn_for_testing(withdrawn_coin);
    test_scenario::return_shared(deepbook_registry);
    test_scenario::return_to_sender(&scenario, admin_cap);
    transfer::public_transfer(trader_account, sender);
    scenario.end();
}

#[test]
fun refresh_quotes_places_quotes_and_emits_quote_updated() {
    let sender = @0x20;
    let base_spread_bps = 100;
    let volatility_spread_bps = 200;
    let oracle_price = 100 * constants::float_scaling();
    let quote_balance = 19_404_002 * constants::float_scaling();
    let feed_id_byte = 7;
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    clock::create_for_testing(scenario.ctx()).share_for_testing();

    scenario.next_tx(sender);

    let clock_for_price_feed: Clock = scenario.take_shared();
    pyth::price_info::publish_price_feed(
        build_pyth_price_feed_id(feed_id_byte),
        10_000,
        false,
        0,
        2,
        true,
        &clock_for_price_feed,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock_for_price_feed);

    scenario.next_tx(sender);

    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let mut deepbook_registry: Registry = scenario.take_shared();

    manager::create_amm_config_and_share(
        &admin_cap,
        base_spread_bps,
        volatility_spread_bps,
        false,
        build_pyth_price_feed_id(feed_id_byte),
        scenario.ctx(),
    );

    let deepbook_admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
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

    let mut trader_account = executor::create_trader_account(
        &admin_cap,
        &deepbook_registry,
        scenario.ctx(),
    );
    trader_account.deposit(
        &admin_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    trader_account.deposit(
        &admin_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    destroy(deepbook_admin_cap);
    test_scenario::return_to_sender(&scenario, admin_cap);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);

    let mut trader_account: TraderAccount = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let config: AMMConfig = scenario.take_shared();
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();

    trader_account.refresh_quotes(
        &mut pool,
        &config,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );

    assert_emitted!(quote_updated(oracle_price, base_spread_bps, volatility_spread_bps));
    assert_eq!(event::events_by_type<OrderFilled>().length(), 0);
    assert_eq!(event::events_by_type<OrderFullyFilled>().length(), 0);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(config);
    test_scenario::return_shared(price_info_object);
    test_scenario::return_shared(clock);
    transfer::public_transfer(trader_account, sender);
    scenario.end();
}

#[test, expected_failure(abort_code = executor::ETradingPaused)]
fun refresh_quotes_rejects_when_trading_paused() {
    let sender = @0x21;
    let feed_id_byte = 8;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    clock::create_for_testing(scenario.ctx()).share_for_testing();

    scenario.next_tx(sender);

    let clock_for_price_feed: Clock = scenario.take_shared();
    pyth::price_info::publish_price_feed(
        build_pyth_price_feed_id(feed_id_byte),
        10_000,
        false,
        0,
        2,
        true,
        &clock_for_price_feed,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock_for_price_feed);

    scenario.next_tx(sender);

    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let mut deepbook_registry: Registry = scenario.take_shared();

    manager::create_amm_config_and_share(
        &admin_cap,
        100,
        200,
        false,
        build_pyth_price_feed_id(feed_id_byte),
        scenario.ctx(),
    );

    let deepbook_admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
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

    let mut trader_account = executor::create_trader_account(
        &admin_cap,
        &deepbook_registry,
        scenario.ctx(),
    );
    trader_account.deposit(
        &admin_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    trader_account.deposit(
        &admin_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    destroy(deepbook_admin_cap);
    test_scenario::return_to_sender(&scenario, admin_cap);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);

    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let mut config: AMMConfig = scenario.take_shared();
    config.update_amm_config(
        &admin_cap,
        100,
        200,
        false,
        true,
        build_pyth_price_feed_id(feed_id_byte),
    );
    test_scenario::return_shared(config);
    test_scenario::return_to_sender(&scenario, admin_cap);

    scenario.next_tx(sender);

    let mut trader_account: TraderAccount = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let config: AMMConfig = scenario.take_shared();
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();

    trader_account.refresh_quotes(
        &mut pool,
        &config,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = executor::EPythFeedIdentifierMismatch)]
fun refresh_quotes_rejects_when_feed_mismatch() {
    let sender = @0x22;
    let config_feed_id_byte = 9;
    let oracle_feed_id_byte = 10;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);

    clock::create_for_testing(scenario.ctx()).share_for_testing();

    scenario.next_tx(sender);

    let clock_for_price_feed: Clock = scenario.take_shared();
    pyth::price_info::publish_price_feed(
        build_pyth_price_feed_id(oracle_feed_id_byte),
        10_000,
        false,
        0,
        2,
        true,
        &clock_for_price_feed,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock_for_price_feed);

    scenario.next_tx(sender);

    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let mut deepbook_registry: Registry = scenario.take_shared();

    manager::create_amm_config_and_share(
        &admin_cap,
        100,
        200,
        false,
        build_pyth_price_feed_id(config_feed_id_byte),
        scenario.ctx(),
    );

    let deepbook_admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
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

    let mut trader_account = executor::create_trader_account(
        &admin_cap,
        &deepbook_registry,
        scenario.ctx(),
    );
    trader_account.deposit(
        &admin_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    trader_account.deposit(
        &admin_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    destroy(deepbook_admin_cap);
    test_scenario::return_to_sender(&scenario, admin_cap);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);
    let mut trader_account: TraderAccount = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let config: AMMConfig = scenario.take_shared();
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();

    trader_account.refresh_quotes(
        &mut pool,
        &config,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );

    abort
}

#[test]
fun refresh_quotes_matches_orders_and_emits_fill_events() {
    let sender = @0x30;
    let maker = @0x31;
    let base_spread_bps = 100;
    let volatility_spread_bps = 200;
    let oracle_price = 100 * constants::float_scaling();
    let quote_balance = 19_404_002 * constants::float_scaling();
    let feed_id_byte = 11;
    let mut scenario = test_scenario::begin(sender);

    manager::test_init(scenario.ctx());
    create_authorized_registry(&mut scenario, sender);

    scenario.next_tx(sender);
    clock::create_for_testing(scenario.ctx()).share_for_testing();

    scenario.next_tx(sender);
    let clock_for_price_feed: Clock = scenario.take_shared();
    pyth::price_info::publish_price_feed(
        build_pyth_price_feed_id(feed_id_byte),
        10_000,
        false,
        0,
        2,
        true,
        &clock_for_price_feed,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock_for_price_feed);

    scenario.next_tx(sender);
    let admin_cap: AMMAdminCap = scenario.take_from_sender();
    let mut deepbook_registry: Registry = scenario.take_shared();

    manager::create_amm_config_and_share(
        &admin_cap,
        base_spread_bps,
        volatility_spread_bps,
        false,
        build_pyth_price_feed_id(feed_id_byte),
        scenario.ctx(),
    );

    let deepbook_admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
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

    let mut trader_account = executor::create_trader_account(
        &admin_cap,
        &deepbook_registry,
        scenario.ctx(),
    );
    trader_account.deposit(
        &admin_cap,
        mint_for_testing<SUI>(2 * constants::min_size(), scenario.ctx()),
        scenario.ctx(),
    );
    trader_account.deposit(
        &admin_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    test_scenario::return_shared(deepbook_registry);
    destroy(deepbook_admin_cap);
    test_scenario::return_to_sender(&scenario, admin_cap);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(sender);
    let mut trader_account: TraderAccount = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let config: AMMConfig = scenario.take_shared();
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();

    trader_account.refresh_quotes(
        &mut pool,
        &config,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );

    assert_emitted!(quote_updated(oracle_price, base_spread_bps, volatility_spread_bps));

    test_scenario::return_shared(pool);
    test_scenario::return_shared(config);
    test_scenario::return_shared(price_info_object);
    test_scenario::return_shared(clock);
    transfer::public_transfer(trader_account, sender);

    scenario.next_tx(maker);

    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();
    let mut taker_balance_manager = balance_manager::new(scenario.ctx());
    taker_balance_manager.deposit(
        mint_for_testing<USDC>(100_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    let taker_trade_proof = taker_balance_manager.generate_proof_as_owner(scenario.ctx());

    pool.place_market_order(
        &mut taker_balance_manager,
        &taker_trade_proof,
        99,
        constants::self_matching_allowed(),
        constants::min_size(),
        true,
        false,
        &clock,
        scenario.ctx(),
    );

    assert!(event::events_by_type<OrderFilled>().length() > 0);
    assert!(event::events_by_type<OrderFullyFilled>().length() > 0);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    transfer::public_share_object(taker_balance_manager);
    scenario.end();
}
