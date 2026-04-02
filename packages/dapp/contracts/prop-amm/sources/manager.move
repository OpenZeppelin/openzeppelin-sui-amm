/// AMM configuration and admin controls.
module openzeppelin_market_maker::manager;

use openzeppelin_market_maker::events;
use pyth::price_info::PriceInfoObject;
use sui::package;

// === Errors ===

#[error(code = 0)]
const EInvalidBaseSpreadBps: vector<u8> = "base spread bps must be greater than zero";
#[error(code = 1)]
const EBaseSpreadBpsExceedsVolatilitySpread: vector<u8> =
    "base spread should not exceed a volatility spread";
#[error(code = 2)]
const EVolatilitySpreadBpsExceedsMaxBasisPoints: vector<u8> =
    "volatility spread bps must be at most 10000";
#[error(code = 3)]
const EInvalidPythPriceFeedIdLength: vector<u8> = "pyth price feed id must be 32 bytes";

// === Constants ===

const HUNDRED_PERCENT_BPS_U128: u128 = 10_000;
const HUNDRED_PERCENT_BPS: u64 = 10_000;
const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;

// === Structs ===

/// One-time publisher witness created at publish time.
public struct MANAGER has drop {}

/// AMM configuration shared across pools.
public struct AMMConfig has key {
    /// Unique ID for the config object.
    id: UID,
    /// Whether trading is paused.
    trading_paused: bool,
    /// Base spread in basis points.
    base_spread_bps: u64,
    /// Volatility spread in basis points.
    volatility_spread_bps: u64,
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

// === Init ===

/// Initializes the package and transfers the admin capability to the publisher.
///
/// This is intended to run once at publish time via the one-time witness.
fun init(publisher_witness: MANAGER, ctx: &mut TxContext) {
    package::claim_and_keep<MANAGER>(publisher_witness, ctx);

    let admin_cap = AMMAdminCap { id: object::new(ctx) };
    transfer::transfer(admin_cap, ctx.sender());
}

// === Public Functions ===

/// Creates a new AMM configuration object with validated inputs.
///
/// Requires the admin capability used to control this config.
/// Use `create_amm_config_and_share` to share config object.
public fun create_amm_config(
    _: &AMMAdminCap,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
    ctx: &mut TxContext,
): AMMConfig {
    assert_valid_amm_config_inputs!(base_spread_bps, volatility_spread_bps, pyth_price_feed_id);

    let config = AMMConfig {
        id: object::new(ctx),
        base_spread_bps,
        volatility_spread_bps,
        use_laser,
        trading_paused: false,
        pyth_price_feed_id,
    };

    events::emit_amm_config_created(object::id(&config));

    config
}

/// Creates, emits, and shares a new AMM configuration.
/// Requires the admin capability used to control this config.
/// Returns the new configuration's object ID.
public fun create_amm_config_and_share(
    admin_cap: &AMMAdminCap,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
    use_laser: bool,
    pyth_price_feed_id: vector<u8>,
    ctx: &mut TxContext,
): ID {
    let config = create_amm_config(
        admin_cap,
        base_spread_bps,
        volatility_spread_bps,
        use_laser,
        pyth_price_feed_id,
        ctx,
    );
    let config_id = object::id(&config);

    transfer::share_object(config);

    config_id
}

/// Updates a configuration object and emits an update event.
public fun update_amm_config(
    config: &mut AMMConfig,
    _: &AMMAdminCap,
    base_spread_bps: u64,
    volatility_spread_bps: u64,
    use_laser: bool,
    trading_paused: bool,
    pyth_price_feed_id: vector<u8>,
) {
    assert_valid_amm_config_inputs!(base_spread_bps, volatility_spread_bps, pyth_price_feed_id);

    config.base_spread_bps = base_spread_bps;
    config.volatility_spread_bps = volatility_spread_bps;
    config.use_laser = use_laser;
    config.trading_paused = trading_paused;
    config.pyth_price_feed_id = pyth_price_feed_id;

    events::emit_amm_config_updated(object::id(config))
}

// === View helpers ===

/// Returns the base spread in basis points.
public fun base_spread_bps(config: &AMMConfig): u64 {
    config.base_spread_bps
}

/// Compute the base spread in price terms for a given mid price.
public(package) fun base_spread(config: &AMMConfig, mid_price: u64): u64 {
    ((mid_price as u128) * (config.base_spread_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
}

/// Returns the volatility spread in basis points.
public fun volatility_spread_bps(config: &AMMConfig): u64 {
    config.volatility_spread_bps
}

/// Compute the volatility spread in price terms for a given mid price.
public(package) fun volatility_spread(config: &AMMConfig, mid_price: u64): u64 {
    ((mid_price as u128) * (config.volatility_spread_bps as u128) / HUNDRED_PERCENT_BPS_U128) as u64
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

/// Checks whether the price info object contains a valid Pyth price feed ID matching the config.
public fun has_valid_pyth_feed_id(config: &AMMConfig, price_info_object: &PriceInfoObject): bool {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    let actual_price_feed_id = price_info.get_price_identifier().get_bytes();
    actual_price_feed_id == config.pyth_price_feed_id
}

/// Returns the configuration object ID as an address.
public fun config_id(config: &AMMConfig): ID {
    config.id.to_inner()
}

/// Returns the admin capability object ID.
public fun admin_cap_id(admin_cap: &AMMAdminCap): ID {
    admin_cap.id.to_inner()
}

/// Returns the required Pyth price feed identifier length.
public(package) fun pyth_price_identifier_length(): u64 {
    PYTH_PRICE_IDENTIFIER_LENGTH
}

// === Private Functions ===

/// Validates all inputs for a new or updated configuration.
macro fun assert_valid_amm_config_inputs(
    $base_spread_bps: u64,
    $volatility_spread_bps: u64,
    $pyth_price_feed_id: vector<u8>,
) {
    let base_spread_bps = $base_spread_bps;
    let volatility_spread_bps = $volatility_spread_bps;
    let pyth_price_feed_id = $pyth_price_feed_id;
    assert!(base_spread_bps > 0, EInvalidBaseSpreadBps);
    assert!(base_spread_bps <= volatility_spread_bps, EBaseSpreadBpsExceedsVolatilitySpread);
    assert!(
        volatility_spread_bps <= HUNDRED_PERCENT_BPS,
        EVolatilitySpreadBpsExceedsMaxBasisPoints,
    );
    assert!(
        pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );
}

// === Test-Only Helpers ===

#[test_only]
/// Creates the package witness and runs init for tests.
public fun test_init(ctx: &mut TxContext) {
    let publisher_witness = sui::test_utils::create_one_time_witness<MANAGER>();
    init(
        publisher_witness,
        ctx,
    );
}
