/// AMM configuration and admin controls.
module PropAmm::manager;

use sui::event;
use sui::package;

// === Constants ===

const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;

const EInvalidSpread: u64 = 1;
const EEmptyFeedId: u64 = 13;
const EInvalidFeedIdLength: u64 = 34;

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
    config_id: address,
    /// Base spread in basis points.
    base_spread_bps: u64,
    /// Volatility multiplier in basis points.
    volatility_multiplier_bps: u64,
    /// Whether LASER pricing is enabled.
    use_laser: bool,
    /// Whether trading is paused.
    trading_paused: bool,
}

/// Emitted when a configuration object is updated.
public struct AMMConfigUpdatedEvent has copy, drop {
    /// ID of the configuration object.
    config_id: address,
    /// Base spread in basis points.
    base_spread_bps: u64,
    /// Volatility multiplier in basis points.
    volatility_multiplier_bps: u64,
    /// Whether LASER pricing is enabled.
    use_laser: bool,
    /// Whether trading is paused.
    trading_paused: bool,
}

// === Init ===

public struct MANAGER has drop {}

/// Initializes the package and transfers the admin capability to the publisher.
fun init(publisher_witness: MANAGER, ctx: &mut TxContext) {
    package::claim_and_keep<MANAGER>(publisher_witness, ctx);

    let admin_cap = create_admin_cap(ctx);
    transfer_admin_cap(admin_cap, ctx.sender());
}

// === Public Functions ===

/// Creates a new AMM configuration object with validated inputs.
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

    emit_config_created(&config);

    config
}

/// Updates a configuration object; requires the admin capability.
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

    emit_config_updated(config);
}

// === Private Functions ===

/// Ensures the base spread is nonzero.
fun assert_valid_base_spread_bps(base_spread_bps: u64) {
    assert!(base_spread_bps > 0, EInvalidSpread);
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

/// Transfers the admin capability to the recipient.
fun transfer_admin_cap(admin_cap: AMMAdminCap, recipient: address) {
    transfer::public_transfer(admin_cap, recipient);
}

/// Verifies the admin capability is valid.
fun assert_admin_cap(admin_cap: &AMMAdminCap) {
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

/// Emits a configuration created event.
fun emit_config_created(config: &AMMConfig) {
    event::emit(AMMConfigCreatedEvent {
        config_id: config.id.to_address(),
        base_spread_bps: config.base_spread_bps,
        volatility_multiplier_bps: config.volatility_multiplier_bps,
        use_laser: config.use_laser,
        trading_paused: config.trading_paused,
    });
}

/// Emits a configuration updated event.
fun emit_config_updated(config: &AMMConfig) {
    event::emit(AMMConfigUpdatedEvent {
        config_id: config.id.to_address(),
        base_spread_bps: config.base_spread_bps,
        volatility_multiplier_bps: config.volatility_multiplier_bps,
        use_laser: config.use_laser,
        trading_paused: config.trading_paused,
    });
}

/// Validates the Pyth price feed identifier.
fun assert_valid_feed_id(pyth_price_feed_id: &vector<u8>) {
    assert!(!pyth_price_feed_id.is_empty(), EEmptyFeedId);
    assert!(pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH, EInvalidFeedIdLength);
}

// === Test-Only Helpers ===

#[test_only]
/// Shares a configuration object.
public fun share_amm_config(config: AMMConfig) {
    transfer::share_object(config);
}

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
