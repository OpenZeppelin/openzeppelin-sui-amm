/// Tests for market maker behavior.
#[test_only]
module openzeppelin_market_maker::executor_tests;

use deepbook::balance_manager::{Self, BalanceEvent};
use deepbook::constants;
use deepbook::order_info::{OrderFilled, OrderFullyFilled, OrderPlaced};
use deepbook::pool::{Self, Pool};
use deepbook::registry::{Self, Registry};
use openzeppelin_market_maker::config;
use openzeppelin_market_maker::events::{
    QuoteUpdated,
    deposited,
    executor_config_updated,
    executor_created,
    executor_paused,
    executor_unpaused,
    withdrawn
};
use openzeppelin_market_maker::executor::{Self, Executor, AdminCap};
use openzeppelin_market_maker::market;
use openzeppelin_market_maker::test_helpers::{
    USDC,
    USDT,
    assert_emitted,
    build_pyth_price_feed_id,
    create_pool,
    create_sui_currency,
    create_usdc_currency
};
use std::type_name;
use std::unit_test::{assert_eq, destroy};
use sui::clock::{Self, Clock};
use sui::coin::{Self, mint_for_testing};
use sui::event;
use sui::sui::SUI;
use sui::test_scenario;

// === Test-Only Constants ===

/// Stand-in feed identifier byte for the base asset (SUI) in tests.
const SUI_PYTH_FEED_ID_BYTE: u8 = 1;
/// Stand-in feed identifier byte for the quote asset (USDC) in tests.
const USDC_PYTH_FEED_ID_BYTE: u8 = 2;

// === Test-Only Helpers ===

fun create_registry(scenario: &mut test_scenario::Scenario, sender: address) {
    scenario.next_tx(sender);
    registry::test_registry(scenario.ctx());

    scenario.next_tx(sender);

    let admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
    let mut deepbook_registry: Registry = scenario.take_shared();
    deepbook_registry.init_balance_manager_map(&admin_cap, scenario.ctx());

    test_scenario::return_shared(deepbook_registry);
    destroy(admin_cap);
}

fun publish_one_pyth_price_feed(
    scenario: &mut test_scenario::Scenario,
    sender: address,
    feed_id_byte: u8,
): ID {
    scenario.next_tx(sender);
    let mut pyth_state: pyth::pyth_state::State = scenario.take_shared();
    let clock_for_price_feed: Clock = scenario.take_shared();
    // confidence = 250 → conf_ratio_bps = 250 per feed, 500 combined; keeps outer order
    // strictly outside the inner order after tick rounding (see tests below).
    pyth::price_info::publish_price_feed(
        &mut pyth_state,
        build_pyth_price_feed_id(feed_id_byte),
        10_000,
        false,
        250,
        2,
        true,
        &clock_for_price_feed,
        scenario.ctx(),
    );
    test_scenario::return_shared(pyth_state);
    test_scenario::return_shared(clock_for_price_feed);

    scenario.next_tx(sender);
    test_scenario::most_recent_id_shared<pyth::price_info::PriceInfoObject>().destroy_some()
}

/// Initializes the mock Pyth state and shared clock and publishes the SUI and USDC feeds.
/// Returns the `(base, quote)` `PriceInfoObject` ids; tests that only need the shared clock
/// can ignore them with `let (_, _) = ...`.
fun publish_price_feeds(scenario: &mut test_scenario::Scenario, sender: address): (ID, ID) {
    scenario.next_tx(sender);
    pyth::pyth_state::init_for_testing(scenario.ctx());
    clock::create_for_testing(scenario.ctx()).share_for_testing();

    let base_pio_id = publish_one_pyth_price_feed(scenario, sender, SUI_PYTH_FEED_ID_BYTE);
    let quote_pio_id = publish_one_pyth_price_feed(scenario, sender, USDC_PYTH_FEED_ID_BYTE);
    (base_pio_id, quote_pio_id)
}

fun create_executor_for_pool(
    scenario: &mut test_scenario::Scenario,
    sender: address,
    pool: &Pool<SUI, USDC>,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
): (Executor, AdminCap) {
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();
    let market = market::new(
        pool,
        &sui_currency,
        &usdc_currency,
        build_pyth_price_feed_id(SUI_PYTH_FEED_ID_BYTE),
        build_pyth_price_feed_id(USDC_PYTH_FEED_ID_BYTE),
    );
    destroy(sui_currency);
    destroy(usdc_currency);
    let amm_config = config::new(
        base_spread_bps,
        volatility_multiplier_bps,
        30_000,
        30,
        1000,
        5000,
        0,
        true,
    );
    // Restore the native tx sender after `tx_context::dummy()` inside the `create_*_currency`
    // helpers replaced it with @0x0.
    scenario.next_tx(sender);
    let (mut executor_object, executor_cap) = executor::create(
        market,
        amm_config,
        scenario.ctx(),
    );
    // Executors are paused on creation; unpause so tests start in the active state they expect.
    executor_object.unpause(&executor_cap);
    (executor_object, executor_cap)
}

#[test]
fun create_executor_sets_owner_and_emits_created_event() {
    let sender = @0x10;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );

    assert_emitted!(executor_created(executor_object.id(), executor_cap.cap_id()));
    assert_eq!(executor_object.owner(), sender);
    assert_eq!(executor_object.id(), object::id(&executor_object));
    assert_eq!(executor_cap.cap_id(), object::id(&executor_cap));
    assert_eq!(executor_object.market().pool_id(), pool_id);

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);
    scenario.end();
}

#[test]
fun create_executor_and_transfer_moves_objects_to_owner() {
    let sender = @0x11;
    let owner = @0x12;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );
    let executor_id = executor_object.id();
    let executor_cap_id = executor_cap.cap_id();

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, owner);
    transfer::public_transfer(executor_cap, owner);

    scenario.next_tx(owner);

    let executor_object: Executor = scenario.take_from_sender();
    let executor_cap: AdminCap = scenario.take_from_sender();

    assert_eq!(executor_object.owner(), sender);
    assert_eq!(executor_object.id(), executor_id);
    assert_eq!(executor_cap.cap_id(), executor_cap_id);

    transfer::public_transfer(executor_object, owner);
    transfer::public_transfer(executor_cap, owner);
    scenario.end();
}

#[test]
fun create_executor_creates_distinct_accounts_and_caps() {
    let sender = @0x13;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();
    // Reuse the same currencies across both markets — `create_sui_currency`/`create_usdc_currency`
    // register `T` in the `CoinRegistry` and the underlying derived-object claim asserts the
    // currency type hasn't already been registered, so a second call in the same scenario
    // aborts with `ECurrencyAlreadyRegistered`.
    let market_a = market::new(
        &pool,
        &sui_currency,
        &usdc_currency,
        build_pyth_price_feed_id(SUI_PYTH_FEED_ID_BYTE),
        build_pyth_price_feed_id(USDC_PYTH_FEED_ID_BYTE),
    );
    let market_b = market::new(
        &pool,
        &sui_currency,
        &usdc_currency,
        build_pyth_price_feed_id(SUI_PYTH_FEED_ID_BYTE),
        build_pyth_price_feed_id(USDC_PYTH_FEED_ID_BYTE),
    );
    destroy(sui_currency);
    destroy(usdc_currency);
    let amm_config_a = config::new(100, 200, 30_000, 30, 1000, 5000, 0, true);
    let amm_config_b = config::new(125, 250, 30_000, 30, 1000, 5000, 0, true);

    scenario.next_tx(sender);

    let (executor_a, executor_cap_a) = executor::create(
        market_a,
        amm_config_a,
        scenario.ctx(),
    );
    let (executor_b, executor_cap_b) = executor::create(
        market_b,
        amm_config_b,
        scenario.ctx(),
    );

    assert!(executor_a.id() != executor_b.id());
    assert!(executor_cap_a.cap_id() != executor_cap_b.cap_id());
    assert!(executor_a.trade_cap_id() != executor_b.trade_cap_id());
    assert!(executor_a.deposit_cap_id() != executor_b.deposit_cap_id());
    assert!(executor_a.withdraw_cap_id() != executor_b.withdraw_cap_id());
    assert!(executor_a.balance_manager().id() != executor_b.balance_manager().id());

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_a, sender);
    transfer::public_transfer(executor_cap_a, sender);
    transfer::public_transfer(executor_b, sender);
    transfer::public_transfer(executor_cap_b, sender);
    scenario.end();
}

#[test]
fun create_returns_paused_executor() {
    let sender = @0x19;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    let market = market::new(
        &pool,
        &sui_currency,
        &usdc_currency,
        build_pyth_price_feed_id(SUI_PYTH_FEED_ID_BYTE),
        build_pyth_price_feed_id(USDC_PYTH_FEED_ID_BYTE),
    );
    destroy(sui_currency);
    destroy(usdc_currency);
    let amm_config = config::new(100, 200, 30_000, 30, 1000, 5000, 0, true);
    scenario.next_tx(sender);

    let (executor_object, executor_cap) = executor::create(
        market,
        amm_config,
        scenario.ctx(),
    );

    assert!(!executor_object.active());

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);
    scenario.end();
}

#[test]
fun deposit_and_withdraw_updates_executor_balance() {
    let sender = @0x14;
    let deposit_amount = 50 * constants::float_scaling();
    let withdraw_amount = 15 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (_, _) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );

    executor_object.deposit(
        &executor_cap,
        mint_for_testing<SUI>(deposit_amount, scenario.ctx()),
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<BalanceEvent>().length(), 1);
    assert_emitted!(
        deposited(
            executor_object.id(),
            type_name::with_defining_ids<SUI>(),
            deposit_amount,
        ),
    );

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let executor_cap: AdminCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    executor_object.pause(&executor_cap, &mut pool, &clock, scenario.ctx());
    let withdrawn_coin = executor_object.withdraw<SUI>(
        &executor_cap,
        withdraw_amount,
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<BalanceEvent>().length(), 1);
    assert_emitted!(
        withdrawn(
            executor_object.id(),
            type_name::with_defining_ids<SUI>(),
            withdraw_amount,
        ),
    );

    assert_eq!(withdrawn_coin.value(), withdraw_amount);
    assert_eq!(executor_object.balance_manager().balance<SUI>(), deposit_amount - withdraw_amount);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    coin::burn_for_testing(withdrawn_coin);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);
    scenario.end();
}

#[test]
fun withdraw_all_returns_full_balance_and_zeroes_remaining() {
    let sender = @0x25;
    let deposit_amount = 50 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (_, _) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );

    executor_object.deposit(
        &executor_cap,
        mint_for_testing<SUI>(deposit_amount, scenario.ctx()),
        scenario.ctx(),
    );

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let executor_cap: AdminCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    executor_object.pause(&executor_cap, &mut pool, &clock, scenario.ctx());

    let withdrawn_coin = executor_object.withdraw_all<SUI>(&executor_cap, scenario.ctx());

    assert_emitted!(
        withdrawn(
            executor_object.id(),
            type_name::with_defining_ids<SUI>(),
            deposit_amount,
        ),
    );

    assert_eq!(withdrawn_coin.value(), deposit_amount);
    assert_eq!(executor_object.balance_manager().balance<SUI>(), 0);
    assert_eq!(executor_object.info().base_balance(), 0);
    assert_eq!(executor_object.info().base_withdrawn(), deposit_amount as u128);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    coin::burn_for_testing(withdrawn_coin);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);
    scenario.end();
}

#[test, expected_failure(abort_code = executor::EUnsupportedAsset)]
fun deposit_aborts_when_coin_type_is_not_base_or_quote() {
    let sender = @0x14;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );

    // USDT is neither the configured base (SUI) nor the configured quote (USDC) — should abort.
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<USDT>(constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = executor::EUnsupportedAsset)]
fun withdraw_aborts_when_coin_type_is_not_base_or_quote() {
    let sender = @0x14;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (_, _) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );

    // Withdraw requires the executor to be paused (otherwise ENotPaused triggers first).
    let clock: Clock = scenario.take_shared();
    executor_object.pause(&executor_cap, &mut pool, &clock, scenario.ctx());

    // USDT is neither base nor quote — should abort with EUnsupportedAsset.
    let withdrawn_coin = executor_object.withdraw<USDT>(
        &executor_cap,
        constants::float_scaling(),
        scenario.ctx(),
    );
    coin::burn_for_testing(withdrawn_coin);

    abort
}

#[test]
fun update_config_replaces_config_before_refreshing_quotes() {
    let sender = @0x15;
    let updated_base_spread_bps = 150;
    let updated_volatility_multiplier_bps = 300;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (base_pio_id, quote_pio_id) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<BalanceEvent>().length(), 2);

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let executor_cap: AdminCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let base_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        base_pio_id,
    );
    let quote_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        quote_pio_id,
    );
    let clock: Clock = scenario.take_shared();

    let updated_config = config::new(
        updated_base_spread_bps,
        updated_volatility_multiplier_bps,
        30_000,
        30,
        1000,
        5000,
        0,
        true,
    );
    let ticket = executor_object.update_config(&executor_cap, updated_config);
    assert_emitted!(executor_config_updated(executor_object.id()));
    executor_object.refresh_quotes_pyth_after_update(
        ticket,
        &mut pool,
        &base_price_info_object,
        &quote_price_info_object,
        &clock,
        scenario.ctx(),
    );

    assert!(event::events_by_type<QuoteUpdated>().length() >= 1);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(base_price_info_object);
    test_scenario::return_shared(quote_price_info_object);
    test_scenario::return_shared(clock);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);
    scenario.end();
}

#[test]
fun pause_and_unpause_emit_events_and_toggle_executor_activity() {
    let sender = @0x16;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (_, _) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let executor_cap: AdminCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    executor_object.pause(&executor_cap, &mut pool, &clock, scenario.ctx());
    assert_emitted!(executor_paused(executor_object.id()));
    assert!(!executor_object.active());

    executor_object.unpause(&executor_cap);
    assert_emitted!(executor_unpaused(executor_object.id()));
    assert!(executor_object.active());

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);
    scenario.end();
}

#[test]
fun unpause_emits_event_in_followup_transaction() {
    let sender = @0x17;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (_, _) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let executor_cap: AdminCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    executor_object.pause(&executor_cap, &mut pool, &clock, scenario.ctx());
    assert_emitted!(executor_paused(executor_object.id()));

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let executor_cap: AdminCap = scenario.take_from_sender();
    executor_object.unpause(&executor_cap);

    assert_emitted!(executor_unpaused(executor_object.id()));
    assert!(executor_object.active());

    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);
    scenario.end();
}

#[test]
fun update_config_preserves_paused_state() {
    let sender = @0x18;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (_, _) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let executor_cap: AdminCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    executor_object.pause(&executor_cap, &mut pool, &clock, scenario.ctx());
    assert_emitted!(executor_paused(executor_object.id()));

    let updated_config = config::new(120, 240, 30_000, 30, 1000, 5000, 0, true);
    let ticket = executor_object.update_config(&executor_cap, updated_config);
    executor_object.cancel_orders_after_update(ticket, &mut pool, &clock, scenario.ctx());

    assert_emitted!(executor_config_updated(executor_object.id()));
    assert!(!executor_object.active());

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);
    scenario.end();
}

#[test, expected_failure(abort_code = executor::EConfigUnchanged)]
fun update_config_rejects_when_unchanged() {
    let sender = @0x1b;
    let base_spread_bps = 100;
    let volatility_multiplier_bps = 200;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (_, _) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        base_spread_bps,
        volatility_multiplier_bps,
    );

    // Build a config identical to the one `create_executor_for_pool` used.
    let identical_config = config::new(
        base_spread_bps,
        volatility_multiplier_bps,
        30_000,
        30,
        1000,
        5000,
        0,
        true,
    );
    let ticket = executor_object.update_config(&executor_cap, identical_config);

    // Unreachable: `update_config` aborts with `EConfigUnchanged` above. Present so the
    // non-droppable `RefreshTicket` is syntactically consumed for type-checking.
    executor_object.cancel_orders_after_update(ticket, &mut pool, &clock, scenario.ctx());

    abort
}

#[test]
fun refresh_quotes_places_quotes_and_emits_quote_updated() {
    let sender = @0x20;
    let base_spread_bps = 100;
    let volatility_multiplier_bps = 200;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (base_pio_id, quote_pio_id) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        base_spread_bps,
        volatility_multiplier_bps,
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<BalanceEvent>().length(), 2);

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let base_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        base_pio_id,
    );
    let quote_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        quote_pio_id,
    );
    let clock: Clock = scenario.take_shared();

    executor_object.refresh_quotes_permissionless(
        &mut pool,
        &base_price_info_object,
        &quote_price_info_object,
        &clock,
        scenario.ctx(),
    );

    // Verify a QuoteUpdated event was emitted; the per-order details are
    // covered by the `OrderPlaced` count check below, plus integration tests
    // exercise the actual emitted payload via the UI event-log subscriber.
    assert_eq!(event::events_by_type<QuoteUpdated>().length(), 1);

    // Verify all 4 limit orders were placed (2 bids + 2 asks),
    // and assert on their actual placed_quantity.
    assert_eq!(event::events_by_type<OrderPlaced>().length(), 4);

    assert_eq!(event::events_by_type<OrderFilled>().length(), 0);
    assert_eq!(event::events_by_type<OrderFullyFilled>().length(), 0);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(base_price_info_object);
    test_scenario::return_shared(quote_price_info_object);
    test_scenario::return_shared(clock);
    transfer::public_transfer(executor_object, sender);
    scenario.end();
}

#[test]
fun refresh_quotes_ignores_replayed_publish_time() {
    let sender = @0x2a;
    let base_spread_bps = 100;
    let volatility_multiplier_bps = 200;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (base_pio_id, quote_pio_id) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        base_spread_bps,
        volatility_multiplier_bps,
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<BalanceEvent>().length(), 2);

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let base_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        base_pio_id,
    );
    let quote_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        quote_pio_id,
    );
    let clock: Clock = scenario.take_shared();

    assert_eq!(event::events_by_type<QuoteUpdated>().length(), 0);

    executor_object.refresh_quotes_permissionless(
        &mut pool,
        &base_price_info_object,
        &quote_price_info_object,
        &clock,
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<QuoteUpdated>().length(), 1);

    // Same oracle publish timestamp should be treated as stale and skip quote refresh.
    executor_object.refresh_quotes_permissionless(
        &mut pool,
        &base_price_info_object,
        &quote_price_info_object,
        &clock,
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<QuoteUpdated>().length(), 1);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(base_price_info_object);
    test_scenario::return_shared(quote_price_info_object);
    test_scenario::return_shared(clock);
    transfer::public_transfer(executor_object, sender);
    scenario.end();
}

#[test, expected_failure(abort_code = executor::EPythFeedIdentifierMismatch)]
fun refresh_quotes_rejects_when_feed_mismatch() {
    let sender = @0x21;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (base_pio_id, quote_pio_id) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    // Swap the base/quote PriceInfoObjects so the executor's base feed id check fails.
    let base_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        quote_pio_id,
    );
    let quote_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        base_pio_id,
    );
    let clock: Clock = scenario.take_shared();

    executor_object.refresh_quotes_permissionless(
        &mut pool,
        &base_price_info_object,
        &quote_price_info_object,
        &clock,
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = executor::EInvalidPool)]
fun refresh_quotes_rejects_when_pool_mismatch() {
    let sender = @0x22;
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (base_pio_id, quote_pio_id) = publish_price_feeds(&mut scenario, sender);

    let configured_pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    // Create a second pool with a different quote type so DeepBook allows it.
    let deepbook_admin_cap = registry::get_admin_cap_for_testing(scenario.ctx());
    let mut deepbook_registry: Registry = scenario.take_shared();
    let other_pool_id = pool::create_pool_admin<SUI, USDT>(
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
    destroy(deepbook_admin_cap);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(configured_pool_id);

    let (executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        100,
        200,
    );
    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let mut other_pool: Pool<SUI, USDT> = scenario.take_shared_by_id(other_pool_id);
    let base_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        base_pio_id,
    );
    let quote_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        quote_pio_id,
    );
    let clock: Clock = scenario.take_shared();

    executor_object.refresh_quotes_permissionless(
        &mut other_pool,
        &base_price_info_object,
        &quote_price_info_object,
        &clock,
        scenario.ctx(),
    );

    abort
}

#[test]
fun refresh_quotes_matches_orders_and_emits_fill_events() {
    let sender = @0x23;
    let maker = @0x24;
    let base_spread_bps = 100;
    let volatility_multiplier_bps = 200;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    executor::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let (base_pio_id, quote_pio_id) = publish_price_feeds(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);

    let (mut executor_object, executor_cap) = create_executor_for_pool(
        &mut scenario,
        sender,
        &pool,
        base_spread_bps,
        volatility_multiplier_bps,
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<SUI>(2 * constants::min_size(), scenario.ctx()),
        scenario.ctx(),
    );
    executor_object.deposit(
        &executor_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<BalanceEvent>().length(), 2);

    test_scenario::return_shared(pool);
    transfer::public_transfer(executor_object, sender);
    transfer::public_transfer(executor_cap, sender);

    scenario.next_tx(sender);

    let mut executor_object: Executor = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let base_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        base_pio_id,
    );
    let quote_price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared_by_id(
        quote_pio_id,
    );
    let clock: Clock = scenario.take_shared();

    executor_object.refresh_quotes_permissionless(
        &mut pool,
        &base_price_info_object,
        &quote_price_info_object,
        &clock,
        scenario.ctx(),
    );

    assert!(event::events_by_type<QuoteUpdated>().length() >= 1);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(base_price_info_object);
    test_scenario::return_shared(quote_price_info_object);
    test_scenario::return_shared(clock);
    transfer::public_transfer(executor_object, sender);

    scenario.next_tx(maker);

    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();
    let mut taker_balance_manager = balance_manager::new(scenario.ctx());
    taker_balance_manager.deposit(
        mint_for_testing<USDC>(100_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<BalanceEvent>().length(), 1);
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
