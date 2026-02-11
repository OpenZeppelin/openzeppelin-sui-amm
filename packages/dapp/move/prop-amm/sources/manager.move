/// AMM configuration and admin controls.
module prop_amm::manager;

use sui::event;
use sui::package;

// === Imports ===

// === Errors ===

const EInvalidSpread: u64 = 1;
const EEmptyFeedId: u64 = 13;
const EInvalidFeedIdLength: u64 = 34;
const ENotAdminCapRecipient: u64 = 55;
const EAdminCapAlreadyClaimed: u64 = 56;

// === Constants ===

const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;

// === Structs ===

/// AMM configuration shared across pools.
public struct AMMConfig has key {
    /// Unique ID for the config object.
    id: UID,
    /// Whether trading is paused.
    trading_paused: bool,
    /// Base spread in basis points.
    base_spread_bps: u64,
    /// Volatility multiplier in basis points.
    volatility_multiplier_bps: u64,
    /// Pyth price feed identifier bytes.
    pyth_price_feed_id: vector<u8>,
    /// Whether LASER pricing is enabled.
    use_laser: bool,
}

/// Capability required to update configuration.
public struct AMMAdminCap has key, store {
    /// Unique ID for the admin capability object.
    id: UID,
}

/// Shared store holding the admin cap until claimed by the publisher.
public struct AdminCapStore has key {
    /// Unique ID for the store object.
    id: UID,
    /// Expected recipient for the admin cap.
    recipient: address,
    /// Admin capability to be claimed.
    admin_cap: Option<AMMAdminCap>,
}

// === Events ===

/// Emitted when a new configuration object is created.
public struct AMMConfigCreatedEvent has copy, drop {
    /// ID of the configuration object.
    config_id: address,
}

/// Emitted when a configuration object is updated.
public struct AMMConfigUpdatedEvent has copy, drop {
    /// ID of the configuration object.
    config_id: address,
}

// === Init ===

/// One-time publisher witness created at publish time.
public struct MANAGER has drop {}

/// Initializes the package and shares the admin cap store for the publisher.
///
/// This is intended to run once at publish time via the one-time witness.
fun init(publisher_witness: MANAGER, ctx: &mut TxContext) {
    package::claim_and_keep<MANAGER>(publisher_witness, ctx);

    let admin_cap = create_admin_cap(ctx);
    let store = AdminCapStore {
        id: object::new(ctx),
        recipient: ctx.sender(),
        admin_cap: option::some(admin_cap),
    };
    transfer::share_object(store);
}

// === Entry Functions ===

/// Creates, emits, and shares a new AMM configuration.
public fun create_amm_config_and_share(
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
    ctx: &mut TxContext,
) {
    let config = create_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );
    event::emit(build_config_created_event(&config));
    share_amm_config(config);
}

/// Updates a configuration object and emits an update event.
public fun update_amm_config_and_emit(
    config: &mut AMMConfig,
    admin_cap: &AMMAdminCap,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    trading_paused: bool,
    pyth_price_feed_id: vector<u8>,
) {
    update_amm_config(
        config,
        admin_cap,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        pyth_price_feed_id,
    );
    event::emit(build_config_updated_event(config));
}

/// Shares a configuration object.
///
/// Shared configs are readable by anyone; only the admin cap can update.
/// This function does not emit events.
public fun share_amm_config(config: AMMConfig) {
    transfer::share_object(config);
}

// === Public Functions ===

/// Creates a new AMM configuration object with validated inputs.
///
/// The returned object is owned; call `share_amm_config` to make it shared.
/// Use `create_amm_config_and_share` to emit the creation event.
public fun create_amm_config(
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
    ctx: &mut TxContext,
): AMMConfig {
    assert_valid_amm_config_inputs(base_spread_bps, &pyth_price_feed_id);

    let config = create_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );

    config
}

/// Updates a configuration object; requires the admin capability.
///
/// The admin capability is the authorization proof for config mutations.
/// Use `update_amm_config_and_emit` to emit the update event.
public fun update_amm_config(
    config: &mut AMMConfig,
    admin_cap: &AMMAdminCap,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    trading_paused: bool,
    pyth_price_feed_id: vector<u8>,
) {
    assert_admin_cap(admin_cap);
    assert_valid_amm_config_inputs(base_spread_bps, &pyth_price_feed_id);

    apply_amm_config_updates(
        config,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        pyth_price_feed_id,
    );
}

/// Claims the admin capability from the shared store.
entry fun claim_admin_cap(store: &mut AdminCapStore, ctx: &TxContext) {
    let admin_cap = claim_admin_cap_from_store(store, ctx.sender());
    transfer::public_transfer(admin_cap, ctx.sender());
}

// === Private Functions ===

/// Ensures the base spread is nonzero.
fun assert_valid_base_spread_bps(base_spread_bps: u64) {
    assert!(base_spread_bps > 0, EInvalidSpread);
}

/// Extracts the admin capability from storage for the expected recipient.
fun claim_admin_cap_from_store(
    store: &mut AdminCapStore,
    expected_recipient: address,
): AMMAdminCap {
    assert!(expected_recipient == store.recipient, ENotAdminCapRecipient);
    assert!(option::is_some(&store.admin_cap), EAdminCapAlreadyClaimed);

    option::extract(&mut store.admin_cap)
}

/// Validates all inputs for a new or updated configuration.
fun assert_valid_amm_config_inputs(base_spread_bps: u64, pyth_price_feed_id: &vector<u8>) {
    assert_valid_base_spread_bps(base_spread_bps);
    assert_valid_feed_id(pyth_price_feed_id);
}

/// Builds a configuration object with default flags.
fun create_config(
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
    ctx: &mut TxContext,
): AMMConfig {
    AMMConfig {
        id: object::new(ctx),
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused: false,
        pyth_price_feed_id,
    }
}

/// Creates a new admin capability object.
fun create_admin_cap(ctx: &mut TxContext): AMMAdminCap {
    AMMAdminCap { id: object::new(ctx) }
}

/// Verifies the admin capability is valid.
public(package) fun assert_admin_cap(admin_cap: &AMMAdminCap) {
    let _ = admin_cap.id.to_address();
}

/// Applies updates to the configuration object.
fun apply_amm_config_updates(
    config: &mut AMMConfig,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    trading_paused: bool,
    pyth_price_feed_id: vector<u8>,
) {
    config.base_spread_bps = base_spread_bps;
    config.volatility_multiplier_bps = volatility_multiplier_bps;
    config.use_laser = use_laser;
    config.trading_paused = trading_paused;
    config.pyth_price_feed_id = pyth_price_feed_id;
}

/// Builds an AMMConfigCreatedEvent payload.
fun build_config_created_event(config: &AMMConfig): AMMConfigCreatedEvent {
    AMMConfigCreatedEvent {
        config_id: config.id.to_address(),
    }
}

/// Builds an AMMConfigUpdatedEvent payload.
fun build_config_updated_event(config: &AMMConfig): AMMConfigUpdatedEvent {
    AMMConfigUpdatedEvent {
        config_id: config.id.to_address(),
    }
}

/// Validates the Pyth price feed identifier.
///
/// Pyth feed IDs are 32-byte identifiers.
fun assert_valid_feed_id(pyth_price_feed_id: &vector<u8>) {
    assert!(!pyth_price_feed_id.is_empty(), EEmptyFeedId);
    assert!(pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH, EInvalidFeedIdLength);
}

// === Test-Only Helpers ===

#[test_only]
/// Creates the package witness and runs init for tests.
public fun init_for_testing(ctx: &mut TxContext) {
    let publisher_witness = sui::test_utils::create_one_time_witness<MANAGER>();
    init(
        publisher_witness,
        ctx,
    );
}

#[test_only]
/// Returns the base spread for tests.
public fun base_spread_bps(config: &AMMConfig): u64 {
    config.base_spread_bps
}

#[test_only]
/// Returns the volatility multiplier for tests.
public fun volatility_multiplier_bps(config: &AMMConfig): u64 {
    config.volatility_multiplier_bps
}

#[test_only]
/// Returns the LASER flag for tests.
public fun use_laser(config: &AMMConfig): bool {
    config.use_laser
}

#[test_only]
/// Returns the trading paused flag for tests.
public fun trading_paused(config: &AMMConfig): bool {
    config.trading_paused
}

#[test_only]
/// Returns the Pyth price feed ID for tests.
public fun pyth_price_feed_id(config: &AMMConfig): &vector<u8> {
    &config.pyth_price_feed_id
}
