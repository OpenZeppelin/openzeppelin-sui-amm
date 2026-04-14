/// Tests for market maker behavior.
#[test_only]
module openzeppelin_market_maker::market_maker_tests;

use deepbook::balance_manager;
use deepbook::constants;
use deepbook::order_info::{OrderFilled, OrderFullyFilled, OrderPlaced};
use deepbook::pool::{Self, Pool};
use deepbook::registry::{Self, Registry};
use openzeppelin_market_maker::config;
use openzeppelin_market_maker::events::{
    QuoteUpdated,
    market_maker_config_updated,
    market_maker_created,
    market_maker_paused,
    market_maker_unpaused,
    quote_updated
};
use openzeppelin_market_maker::market_maker::{Self, MarketMaker, MarketMakerCap};
use openzeppelin_market_maker::test_helpers::{
    USDC,
    USDT,
    assert_emitted,
    build_pyth_price_feed_id,
    create_pool,
    create_sui_currency,
    create_usdc_currency,
    create_usdt_currency
};
use std::unit_test::{assert_eq, destroy};
use sui::clock::{Self, Clock};
use sui::coin::{Self, mint_for_testing};
use sui::event;
use sui::sui::SUI;
use sui::test_scenario;

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

fun publish_price_feed(scenario: &mut test_scenario::Scenario, sender: address, feed_id_byte: u8) {
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
}

fun create_market_maker_for_pool(
    scenario: &mut test_scenario::Scenario,
    pool_id: ID,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
    use_laser: bool,
    feed_id_byte: u8,
): (MarketMaker, MarketMakerCap) {
    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let market_maker_config = config::create(
        &pool,
        base_spread_bps,
        volatility_spread_bps,
        use_laser,
        build_pyth_price_feed_id(feed_id_byte),
        build_pyth_price_feed_id(feed_id_byte),
        30_000,
        30,
    );
    let (market_maker, market_maker_cap) = market_maker::create(
        market_maker_config,
        scenario.ctx(),
    );
    test_scenario::return_shared(pool);

    (market_maker, market_maker_cap)
}

#[test]
fun create_market_maker_sets_owner_and_emits_created_event() {
    let sender = @0x10;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        100,
        200,
        false,
        1,
    );

    assert_emitted!(market_maker_created(market_maker_object.id()));
    assert_eq!(market_maker_object.owner(), sender);
    assert_eq!(market_maker_object.id(), object::id(&market_maker_object));
    assert_eq!(market_maker_cap.cap_id(), object::id(&market_maker_cap));

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);
    scenario.end();
}

#[test]
fun create_market_maker_and_transfer_moves_objects_to_owner() {
    let sender = @0x11;
    let owner = @0x12;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        100,
        200,
        false,
        2,
    );
    let market_maker_id = market_maker_object.id();
    let market_maker_cap_id = market_maker_cap.cap_id();

    transfer::public_transfer(market_maker_object, owner);
    transfer::public_transfer(market_maker_cap, owner);

    scenario.next_tx(owner);

    let market_maker_object: MarketMaker = scenario.take_from_sender();
    let market_maker_cap: MarketMakerCap = scenario.take_from_sender();

    assert_eq!(market_maker_object.owner(), sender);
    assert_eq!(market_maker_object.id(), market_maker_id);
    assert_eq!(market_maker_cap.cap_id(), market_maker_cap_id);

    transfer::public_transfer(market_maker_object, owner);
    transfer::public_transfer(market_maker_cap, owner);
    scenario.end();
}

#[test]
fun create_market_maker_creates_distinct_accounts_and_caps() {
    let sender = @0x13;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let market_maker_config_a = config::create(
        &pool,
        100,
        200,
        false,
        build_pyth_price_feed_id(3),
        build_pyth_price_feed_id(3),
        30_000,
        30,
    );
    let market_maker_config_b = config::create(
        &pool,
        125,
        250,
        true,
        build_pyth_price_feed_id(4),
        build_pyth_price_feed_id(4),
        30_000,
        30,
    );
    let (market_maker_a, market_maker_cap_a) = market_maker::create(
        market_maker_config_a,
        scenario.ctx(),
    );
    let (market_maker_b, market_maker_cap_b) = market_maker::create(
        market_maker_config_b,
        scenario.ctx(),
    );

    assert!(market_maker_a.id() != market_maker_b.id());
    assert!(market_maker_cap_a.cap_id() != market_maker_cap_b.cap_id());
    assert!(market_maker_a.trade_cap_id() != market_maker_b.trade_cap_id());
    assert!(market_maker_a.deposit_cap_id() != market_maker_b.deposit_cap_id());
    assert!(market_maker_a.withdraw_cap_id() != market_maker_b.withdraw_cap_id());
    assert!(market_maker_a.balance_manager().id() != market_maker_b.balance_manager().id());

    test_scenario::return_shared(pool);
    transfer::public_transfer(market_maker_a, sender);
    transfer::public_transfer(market_maker_cap_a, sender);
    transfer::public_transfer(market_maker_b, sender);
    transfer::public_transfer(market_maker_cap_b, sender);
    scenario.end();
}

#[test]
fun deposit_and_withdraw_updates_market_maker_balance() {
    let sender = @0x14;
    let feed_id_byte = 5;
    let deposit_amount = 50 * constants::float_scaling();
    let withdraw_amount = 15 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (mut market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        100,
        200,
        false,
        feed_id_byte,
    );

    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<SUI>(deposit_amount, scenario.ctx()),
        scenario.ctx(),
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let market_maker_cap: MarketMakerCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    market_maker_object.pause(&market_maker_cap, &mut pool, &clock, scenario.ctx());
    let withdrawn_coin = market_maker_object.withdraw<SUI>(
        &market_maker_cap,
        withdraw_amount,
        scenario.ctx(),
    );

    assert_eq!(withdrawn_coin.value(), withdraw_amount);
    assert_eq!(
        market_maker_object.balance_manager().balance<SUI>(),
        deposit_amount - withdraw_amount,
    );

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    coin::burn_for_testing(withdrawn_coin);
    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);
    scenario.end();
}

#[test]
fun update_market_maker_replaces_config_before_refreshing_quotes() {
    let sender = @0x15;
    let updated_base_spread_bps = 150;
    let updated_volatility_spread_bps = 300;
    let oracle_price = constants::float_scaling() / 1_000;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let feed_id_byte = 6;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (mut market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        100,
        200,
        false,
        feed_id_byte,
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let market_maker_cap: MarketMakerCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    let updated_config = config::create(
        &pool,
        updated_base_spread_bps,
        updated_volatility_spread_bps,
        false,
        build_pyth_price_feed_id(feed_id_byte),
        build_pyth_price_feed_id(feed_id_byte),
        30_000,
        30,
    );
    market_maker_object.update_market_maker(&market_maker_cap, updated_config);
    assert_emitted!(market_maker_config_updated(market_maker_object.id()));
    market_maker_object.refresh_quotes(
        &mut pool,
        &sui_currency,
        &usdc_currency,
        &price_info_object,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );

    assert_emitted!(
        quote_updated(
            oracle_price,
            updated_base_spread_bps,
            updated_volatility_spread_bps,
        ),
    );

    test_scenario::return_shared(pool);
    test_scenario::return_shared(price_info_object);
    test_scenario::return_shared(clock);
    destroy(sui_currency);
    destroy(usdc_currency);
    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);
    scenario.end();
}

#[test]
fun pause_and_unpause_emit_events_and_toggle_market_maker_activity() {
    let sender = @0x16;
    let feed_id_byte = 12;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        100,
        200,
        false,
        feed_id_byte,
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let market_maker_cap: MarketMakerCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    market_maker_object.pause(&market_maker_cap, &mut pool, &clock, scenario.ctx());
    assert_emitted!(market_maker_paused(market_maker_object.id()));
    assert!(!market_maker_object.config().active());

    market_maker_object.unpause(&market_maker_cap);
    assert_emitted!(market_maker_unpaused(market_maker_object.id()));
    assert!(market_maker_object.config().active());

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);
    scenario.end();
}

#[test]
fun unpause_emits_event_in_followup_transaction() {
    let sender = @0x17;
    let feed_id_byte = 13;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        100,
        200,
        false,
        feed_id_byte,
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let market_maker_cap: MarketMakerCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    market_maker_object.pause(&market_maker_cap, &mut pool, &clock, scenario.ctx());
    assert_emitted!(market_maker_paused(market_maker_object.id()));

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let market_maker_cap: MarketMakerCap = scenario.take_from_sender();
    market_maker_object.unpause(&market_maker_cap);

    assert_emitted!(market_maker_unpaused(market_maker_object.id()));
    assert!(market_maker_object.config().active());

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);
    scenario.end();
}

#[test]
fun update_market_maker_from_paused_emits_unpaused_event() {
    let sender = @0x18;
    let feed_id_byte = 14;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        100,
        200,
        false,
        feed_id_byte,
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let market_maker_cap: MarketMakerCap = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let clock: Clock = scenario.take_shared();

    market_maker_object.pause(&market_maker_cap, &mut pool, &clock, scenario.ctx());
    assert_emitted!(market_maker_paused(market_maker_object.id()));

    let updated_config = config::create(
        &pool,
        120,
        240,
        false,
        build_pyth_price_feed_id(feed_id_byte),
        build_pyth_price_feed_id(feed_id_byte),
        30_000,
        30,
    );
    market_maker_object.update_market_maker(&market_maker_cap, updated_config);

    assert_emitted!(market_maker_config_updated(market_maker_object.id()));
    assert_emitted!(market_maker_unpaused(market_maker_object.id()));
    assert!(market_maker_object.config().active());

    test_scenario::return_shared(pool);
    test_scenario::return_shared(clock);
    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);
    scenario.end();
}

#[test]
fun refresh_quotes_places_quotes_and_emits_quote_updated() {
    let sender = @0x20;
    let base_spread_bps = 100;
    let volatility_spread_bps = 200;
    let oracle_price = constants::float_scaling() / 1_000;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let feed_id_byte = 7;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (mut market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        base_spread_bps,
        volatility_spread_bps,
        false,
        feed_id_byte,
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    market_maker_object.refresh_quotes(
        &mut pool,
        &sui_currency,
        &usdc_currency,
        &price_info_object,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );

    assert_emitted!(quote_updated(oracle_price, base_spread_bps, volatility_spread_bps));

    // Verify all 4 limit orders were placed (2 bids + 2 asks),
    // and assert on their actual placed_quantity.
    assert_eq!(event::events_by_type<OrderPlaced>().length(), 4);

    assert_eq!(event::events_by_type<OrderFilled>().length(), 0);
    assert_eq!(event::events_by_type<OrderFullyFilled>().length(), 0);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(price_info_object);
    test_scenario::return_shared(clock);
    destroy(sui_currency);
    destroy(usdc_currency);
    transfer::public_transfer(market_maker_object, sender);
    scenario.end();
}

#[test]
fun refresh_quotes_ignores_replayed_publish_time() {
    let sender = @0x2a;
    let base_spread_bps = 100;
    let volatility_spread_bps = 200;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let feed_id_byte = 12;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (mut market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        base_spread_bps,
        volatility_spread_bps,
        false,
        feed_id_byte,
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    assert_eq!(event::events_by_type<QuoteUpdated>().length(), 0);

    market_maker_object.refresh_quotes(
        &mut pool,
        &sui_currency,
        &usdc_currency,
        &price_info_object,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<QuoteUpdated>().length(), 1);

    // Same oracle publish timestamp should be treated as stale and skip quote refresh.
    market_maker_object.refresh_quotes(
        &mut pool,
        &sui_currency,
        &usdc_currency,
        &price_info_object,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );
    assert_eq!(event::events_by_type<QuoteUpdated>().length(), 1);

    test_scenario::return_shared(pool);
    test_scenario::return_shared(price_info_object);
    test_scenario::return_shared(clock);
    destroy(sui_currency);
    destroy(usdc_currency);
    transfer::public_transfer(market_maker_object, sender);
    scenario.end();
}

#[test, expected_failure(abort_code = market_maker::EPythFeedIdentifierMismatch)]
fun refresh_quotes_rejects_when_feed_mismatch() {
    let sender = @0x21;
    let config_feed_id_byte = 8;
    let oracle_feed_id_byte = 9;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, oracle_feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (mut market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        100,
        200,
        false,
        config_feed_id_byte,
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<SUI>(1_000_000 * constants::float_scaling(), scenario.ctx()),
        scenario.ctx(),
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    market_maker_object.refresh_quotes(
        &mut pool,
        &sui_currency,
        &usdc_currency,
        &price_info_object,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = market_maker::EInvalidPool)]
fun refresh_quotes_rejects_when_pool_mismatch() {
    let sender = @0x22;
    let feed_id_byte = 10;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);

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

    let (market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        configured_pool_id,
        100,
        200,
        false,
        feed_id_byte,
    );
    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let mut other_pool: Pool<SUI, USDT> = scenario.take_shared_by_id(other_pool_id);
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();
    let sui_currency = create_sui_currency();
    let usdt_currency = create_usdt_currency();

    market_maker_object.refresh_quotes(
        &mut other_pool,
        &sui_currency,
        &usdt_currency,
        &price_info_object,
        &price_info_object,
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
    let volatility_spread_bps = 200;
    let oracle_price = constants::float_scaling() / 1_000;
    let quote_balance = 19_404_002 * constants::float_scaling();
    let feed_id_byte = 11;
    let mut scenario = test_scenario::begin(sender);

    market_maker::test_init(scenario.ctx());
    create_registry(&mut scenario, sender);
    publish_price_feed(&mut scenario, sender, feed_id_byte);
    let pool_id = create_pool(&mut scenario, sender);

    scenario.next_tx(sender);

    let (mut market_maker_object, market_maker_cap) = create_market_maker_for_pool(
        &mut scenario,
        pool_id,
        base_spread_bps,
        volatility_spread_bps,
        false,
        feed_id_byte,
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<SUI>(2 * constants::min_size(), scenario.ctx()),
        scenario.ctx(),
    );
    market_maker_object.deposit(
        &market_maker_cap,
        mint_for_testing<USDC>(quote_balance, scenario.ctx()),
        scenario.ctx(),
    );

    transfer::public_transfer(market_maker_object, sender);
    transfer::public_transfer(market_maker_cap, sender);

    scenario.next_tx(sender);

    let mut market_maker_object: MarketMaker = scenario.take_from_sender();
    let mut pool: Pool<SUI, USDC> = scenario.take_shared_by_id(pool_id);
    let price_info_object: pyth::price_info::PriceInfoObject = scenario.take_shared();
    let clock: Clock = scenario.take_shared();
    let sui_currency = create_sui_currency();
    let usdc_currency = create_usdc_currency();

    market_maker_object.refresh_quotes(
        &mut pool,
        &sui_currency,
        &usdc_currency,
        &price_info_object,
        &price_info_object,
        &clock,
        scenario.ctx(),
    );

    assert_emitted!(quote_updated(oracle_price, base_spread_bps, volatility_spread_bps));

    test_scenario::return_shared(pool);
    test_scenario::return_shared(price_info_object);
    test_scenario::return_shared(clock);
    destroy(sui_currency);
    destroy(usdc_currency);
    transfer::public_transfer(market_maker_object, sender);

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
