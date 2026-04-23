/// Market identity and live price feed state for the traded asset pair.
module openzeppelin_market_maker::market;

use deepbook::pool::Pool;
use pyth::price::Price;
use pyth::price_info::PriceInfoObject;
use std::type_name::{Self, TypeName};
use sui::coin_registry::Currency;

// === Errors ===

#[error(code = 0)]
const EInvalidPythPriceFeedIdLength: vector<u8> = "pyth price feed id must be 32 bytes";
#[error(code = 1)]
const EDecimalsTooLarge: vector<u8> = "currency decimals too large";

// === Constants ===

const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;
const MAX_DECIMAL_POWER: u8 = 38;

// === Structs ===

/// Market metadata: pool identity, cached asset decimals, Pyth feed identifiers, and the
/// latest observed publish timestamps used to detect replayed oracle prices.
public struct Market has drop, store {
    /// ID of the associated pool.
    pool_id: ID,
    /// Base asset type (`BaseAsset`) used to route deposits and withdrawals.
    base_type: TypeName,
    /// Quote asset type (`QuoteAsset`) used to route deposits and withdrawals.
    quote_type: TypeName,
    /// Cached base asset decimals (read from `Currency<BaseAsset>` at creation time).
    base_decimals: u8,
    /// Cached quote asset decimals (read from `Currency<QuoteAsset>` at creation time).
    quote_decimals: u8,
    /// Pyth price feed identifier bytes for the base asset.
    base_pyth_price_feed_id: vector<u8>,
    /// Pyth price feed identifier bytes for the quote asset.
    quote_pyth_price_feed_id: vector<u8>,
    /// Latest observed base asset publish timestamp.
    base_price_publish_time: Option<u64>,
    /// Latest observed quote asset publish timestamp.
    quote_price_publish_time: Option<u64>,
}

// === Public Functions ===

/// Creates a new `Market` bound to the asset pair traded on `pool`.
///
/// The `BaseAsset`/`QuoteAsset` generic parameters of `pool`, `base_currency`, and
/// `quote_currency` must all match — this is what guarantees that the cached decimals and
/// the pool identity are for the same asset pair. The resulting `Market` value is not
/// generically typed; the returned struct carries only the derived `pool_id`, the cached
/// decimals, and the Pyth feed identifiers, so downstream executor state stays non-generic.
///
/// Pass the returned value into `executor::create` when creating a new market maker executor
/// or into `executor::update_market` when replacing the configured market.
public fun new<BaseAsset, QuoteAsset>(
    pool: &Pool<BaseAsset, QuoteAsset>,
    base_currency: &Currency<BaseAsset>,
    quote_currency: &Currency<QuoteAsset>,
    base_pyth_price_feed_id: vector<u8>,
    quote_pyth_price_feed_id: vector<u8>,
): Market {
    assert!(
        base_pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );
    assert!(
        quote_pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );

    let base_decimals = base_currency.decimals();
    let quote_decimals = quote_currency.decimals();
    assert!(base_decimals <= MAX_DECIMAL_POWER, EDecimalsTooLarge);
    assert!(quote_decimals <= MAX_DECIMAL_POWER, EDecimalsTooLarge);

    Market {
        pool_id: object::id(pool),
        base_type: type_name::with_defining_ids<BaseAsset>(),
        quote_type: type_name::with_defining_ids<QuoteAsset>(),
        base_decimals,
        quote_decimals,
        base_pyth_price_feed_id,
        quote_pyth_price_feed_id,
        base_price_publish_time: option::none(),
        quote_price_publish_time: option::none(),
    }
}

// === View helpers ===

/// Returns the associated pool's object ID.
public fun pool_id(market: &Market): ID {
    market.pool_id
}

/// Checks whether the given pool matches the configured pool ID.
public fun has_valid_pool<BaseAsset, QuoteAsset>(
    market: &Market,
    pool: &Pool<BaseAsset, QuoteAsset>,
): bool {
    market.pool_id == object::id(pool)
}

/// Returns the base asset type.
public fun base_type(market: &Market): TypeName {
    market.base_type
}

/// Returns the quote asset type.
public fun quote_type(market: &Market): TypeName {
    market.quote_type
}

/// Returns the cached base asset decimals.
public fun base_decimals(market: &Market): u8 {
    market.base_decimals
}

/// Returns the cached quote asset decimals.
public fun quote_decimals(market: &Market): u8 {
    market.quote_decimals
}

/// Returns the Pyth base asset price feed ID bytes.
public fun base_pyth_price_feed_id(market: &Market): vector<u8> {
    market.base_pyth_price_feed_id
}

/// Returns the Pyth quote asset price feed ID bytes.
public fun quote_pyth_price_feed_id(market: &Market): vector<u8> {
    market.quote_pyth_price_feed_id
}

/// Checks whether the price info object contains a Pyth base asset price feed ID matching the
/// configured market.
public fun has_valid_base_pyth_feed_id(market: &Market, price_info_object: &PriceInfoObject): bool {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    let actual_price_feed_id = price_info.get_price_identifier().get_bytes();
    actual_price_feed_id == market.base_pyth_price_feed_id
}

/// Checks whether the price info object contains a Pyth quote asset price feed ID matching the
/// configured market.
public fun has_valid_quote_pyth_feed_id(
    market: &Market,
    price_info_object: &PriceInfoObject,
): bool {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    let actual_price_feed_id = price_info.get_price_identifier().get_bytes();
    actual_price_feed_id == market.quote_pyth_price_feed_id
}

/// Returns the latest base price publish time in seconds, if any.
public fun base_price_publish_time(market: &Market): Option<u64> {
    market.base_price_publish_time
}

/// Returns the latest quote price publish time in seconds, if any.
public fun quote_price_publish_time(market: &Market): Option<u64> {
    market.quote_price_publish_time
}

/// Returns true when the cached base price publish time is at least as recent as the incoming
/// price timestamp, meaning the base feed has not advanced.
public fun is_base_price_stale(market: &Market, price: Price): bool {
    market
        .base_price_publish_time
        .map!(|publish_time| publish_time >= price.get_timestamp())
        .destroy_or!(false)
}

/// Returns true when the cached quote price publish time is at least as recent as the incoming
/// price timestamp, meaning the quote feed has not advanced.
public fun is_quote_price_stale(market: &Market, price: Price): bool {
    market
        .quote_price_publish_time
        .map!(|publish_time| publish_time >= price.get_timestamp())
        .destroy_or!(false)
}

// === Package Functions ===

/// Returns the required Pyth price feed identifier length.
public(package) fun pyth_price_identifier_length(): u64 {
    PYTH_PRICE_IDENTIFIER_LENGTH
}

/// Returns the maximum supported decimal power for cached asset decimals.
public(package) fun max_decimal_power(): u8 {
    MAX_DECIMAL_POWER
}

/// Sets new base `publish_time` and returns the previous base price publish time, if any.
public(package) fun set_base_price_publish_time(
    market: &mut Market,
    publish_time: u64,
): Option<u64> {
    market.base_price_publish_time.swap_or_fill(publish_time)
}

/// Sets new quote `publish_time` and returns the previous quote price publish time, if any.
public(package) fun set_quote_price_publish_time(
    market: &mut Market,
    publish_time: u64,
): Option<u64> {
    market.quote_price_publish_time.swap_or_fill(publish_time)
}

/// Clears cached base and quote price publish timestamps so the next oracle read is not
/// treated as stale/replayed.
public(package) fun reset_price_publish_times(market: &mut Market) {
    market.base_price_publish_time = option::none();
    market.quote_price_publish_time = option::none();
}
