/// AMM configuration and admin controls.
module prop_amm::manager;

use sui::event;
use sui::package;

// === Constants ===

const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;

// === Errors ===

#[error]
const EInvalidBaseSpreadBps: vector<u8> = b"base spread bps must be greater than zero";
#[error]
const EInvalidPythPriceFeedIdLength: vector<u8> = b"pyth price feed id must be 32 bytes";

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

// === Events ===

/// Emitted when a new configuration object is created.
public struct AMMConfigCreatedEvent has copy, drop {
    /// ID of the configuration object.
    config_id: ID,
}

/// Emitted when a configuration object is updated.
public struct AMMConfigUpdatedEvent has copy, drop {
    /// ID of the configuration object.
    config_id: ID,
}

/// Builds an `AMMConfigCreatedEvent` payload.
public(package) fun new_amm_config_created_event(config_id: ID): AMMConfigCreatedEvent {
    AMMConfigCreatedEvent {
        config_id,
    }
}

/// Builds an `AMMConfigCreatedEvent` payload.
public(package) fun new_amm_config_updated_event(config_id: ID): AMMConfigUpdatedEvent {
    AMMConfigUpdatedEvent {
        config_id,
    }
}

// === Init ===

/// One-time publisher witness created at publish time.
public struct MANAGER has drop {}

/// Initializes the package and transfers the admin capability to the publisher.
///
/// This is intended to run once at publish time via the one-time witness.
fun init(publisher_witness: MANAGER, ctx: &mut TxContext) {
    package::claim_and_keep<MANAGER>(publisher_witness, ctx);

    let admin_cap = new_amm_admin_cap(ctx);
    transfer::transfer(admin_cap, ctx.sender());
}

// === Entry Functions ===

/// Creates, emits, and shares a new AMM configuration.
/// Returns the new configuration's object ID.
public fun create_amm_config_and_share(
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
    ctx: &mut TxContext,
): ID {
    let config = create_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );
    let config_id = config.id.to_inner();
    event::emit(new_amm_config_created_event(config_id));
    transfer::share_object(config);
    config_id
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
    event::emit(new_amm_config_updated_event(config.id.to_inner()));
}

// === Public Functions ===

/// Creates a new AMM configuration object with validated inputs.
///
/// Use `create_amm_config_and_share` to emit the creation event.
public fun create_amm_config(
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
    ctx: &mut TxContext,
): AMMConfig {
    assert_valid_amm_config_inputs!(base_spread_bps, &pyth_price_feed_id);

    new_amm_config(
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    )
}

/// Updates a configuration object; requires the admin capability.
///
/// The admin capability is the authorization proof for config mutations.
/// Use `update_amm_config_and_emit` to emit the update event.
public fun update_amm_config(
    config: &mut AMMConfig,
    _admin_cap: &AMMAdminCap,
    base_spread_bps: u64,
    volatility_multiplier_bps: u64,
    use_laser: bool,
    trading_paused: bool,
    pyth_price_feed_id: vector<u8>,
) {
    assert_valid_amm_config_inputs!(base_spread_bps, &pyth_price_feed_id);

    apply_amm_config_updates(
        config,
        base_spread_bps,
        volatility_multiplier_bps,
        use_laser,
        trading_paused,
        pyth_price_feed_id,
    );
}

// === Private Functions ===

/// Builds a configuration object with default flags.
fun new_amm_config(
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
fun new_amm_admin_cap(ctx: &mut TxContext): AMMAdminCap {
    AMMAdminCap { id: object::new(ctx) }
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

/// Ensures the base spread is non-zero.
macro fun assert_valid_base_spread_bps($base_spread_bps: u64) {
    assert!($base_spread_bps > 0, EInvalidBaseSpreadBps);
}

/// Validates all inputs for a new or updated configuration.
macro fun assert_valid_amm_config_inputs($base_spread_bps: u64, $pyth_price_feed_id: &vector<u8>) {
    assert_valid_base_spread_bps!($base_spread_bps);
    assert_valid_feed_id!($pyth_price_feed_id);
}

/// Validates the Pyth price feed identifier.
///
/// Pyth feed IDs are 32-byte identifiers.
macro fun assert_valid_feed_id($pyth_price_feed_id: &vector<u8>) {
    let pyth_price_feed_id = $pyth_price_feed_id;
    assert!(
        pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );
}

// === View helpers ===

/// Returns the required Pyth price feed identifier length.
public(package) fun pyth_price_identifier_length(): u64 {
    PYTH_PRICE_IDENTIFIER_LENGTH
}

/// Returns the base spread in basis points.
public fun base_spread_bps(config: &AMMConfig): u64 {
    config.base_spread_bps
}

/// Returns the volatility multiplier in basis points.
public fun volatility_multiplier_bps(config: &AMMConfig): u64 {
    config.volatility_multiplier_bps
}

/// Returns whether LASER pricing is enabled.
public fun use_laser(config: &AMMConfig): bool {
    config.use_laser
}

/// Returns whether trading is paused.
public fun trading_paused(config: &AMMConfig): bool {
    config.trading_paused
}

/// Returns the Pyth price feed ID bytes.
public fun pyth_price_feed_id(config: &AMMConfig): vector<u8> {
    config.pyth_price_feed_id
}

/// Returns the configuration object ID as an address.
public fun config_id(config: &AMMConfig): ID {
    config.id.to_inner()
}

/// Returns the admin capability object ID.
public fun admin_cap_id(admin_cap: &AMMAdminCap): ID {
    admin_cap.id.to_inner()
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
