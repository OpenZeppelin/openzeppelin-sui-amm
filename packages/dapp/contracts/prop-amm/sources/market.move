/// Market identity and live price feed state for the traded asset pair.
module openzeppelin_market_maker::market;

use deepbook::constants;
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
#[error(code = 2)]
const EPythPriceNonPositive: vector<u8> = "pyth price must be positive";
#[error(code = 3)]
const EPythExponentNonNegative: vector<u8> = "pyth price exponent_u128 must be negative";
#[error(code = 4)]
const EExponentTooLarge: vector<u8> = "price exponent too large";
#[error(code = 5)]
const EPythPriceConfidenceTooWide: vector<u8> = "pyth price confidence interval is too wide";
#[error(code = 6)]
const EPriceUnderflow: vector<u8> = "price lower than minimum or underflowed";
#[error(code = 7)]
const EPriceOverflow: vector<u8> = "price higher than maximum or overflowed";
#[error(code = 8)]
const EPoolNotWhitelisted: vector<u8> = "deepbook pool must be whitelisted";
#[error(code = 9)]
const EIdenticalPythPriceFeedIds: vector<u8> = "base and quote pyth price feed ids must differ";

// === Constants ===

const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;
const MAX_DECIMAL_POWER: u8 = 19;
const HUNDRED_PERCENT_BPS_U128: u128 = 10_000;

// === Structs ===

/// Market metadata: pool identity, cached asset decimals, Pyth feed identifiers, and the
/// latest observed publish timestamps used to detect replayed oracle prices.
public struct Market has store {
    /// ID of the associated pool.
    pool_id: ID,
    /// Base asset metadata.
    base: MarketCurrency,
    /// Quote asset metadata.
    quote: MarketCurrency,
}

/// Per-side (base or quote) asset metadata.
public struct MarketCurrency has store {
    /// Asset type used to route deposits and withdrawals.
    coin_type: TypeName,
    /// Cached asset decimals (read from the asset's `Currency` object at creation time).
    decimals: u8,
    /// Pyth price feed identifier bytes (32 bytes).
    pyth_price_feed_id: vector<u8>,
    /// Latest observed Pyth publish timestamp for this feed, if any.
    price_publish_time: Option<u64>,
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
/// `pool` must be a whitelisted DeepBook pool (`pool.whitelisted() == true`). On
/// non-whitelisted pools, DeepBook charges a maker fee in the input asset when
/// `pay_with_deep = false`.
/// Pass the returned value into `executor::create` when creating a new market maker executor.
public fun new<BaseAsset, QuoteAsset>(
    pool: &Pool<BaseAsset, QuoteAsset>,
    base_currency: &Currency<BaseAsset>,
    quote_currency: &Currency<QuoteAsset>,
    base_pyth_price_feed_id: vector<u8>,
    quote_pyth_price_feed_id: vector<u8>,
): Market {
    assert!(pool.whitelisted(), EPoolNotWhitelisted);
    assert!(
        base_pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );
    assert!(
        quote_pyth_price_feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH,
        EInvalidPythPriceFeedIdLength,
    );
    assert!(base_pyth_price_feed_id != quote_pyth_price_feed_id, EIdenticalPythPriceFeedIds);

    let base_decimals = base_currency.decimals();
    let quote_decimals = quote_currency.decimals();
    assert!(base_decimals <= MAX_DECIMAL_POWER, EDecimalsTooLarge);
    assert!(quote_decimals <= MAX_DECIMAL_POWER, EDecimalsTooLarge);

    Market {
        pool_id: object::id(pool),
        base: MarketCurrency {
            coin_type: type_name::with_defining_ids<BaseAsset>(),
            decimals: base_decimals,
            pyth_price_feed_id: base_pyth_price_feed_id,
            price_publish_time: option::none(),
        },
        quote: MarketCurrency {
            coin_type: type_name::with_defining_ids<QuoteAsset>(),
            decimals: quote_decimals,
            pyth_price_feed_id: quote_pyth_price_feed_id,
            price_publish_time: option::none(),
        },
    }
}

// === View helpers ===

/// Returns the associated pool's object ID.
public fun pool_id(self: &Market): ID {
    self.pool_id
}

/// Checks whether the given pool matches the configured pool ID.
public fun has_valid_pool<BaseAsset, QuoteAsset>(
    self: &Market,
    pool: &Pool<BaseAsset, QuoteAsset>,
): bool {
    self.pool_id == object::id(pool)
}

/// Returns the base asset type.
public fun base_type(self: &Market): TypeName {
    self.base.coin_type
}

/// Returns the quote asset type.
public fun quote_type(self: &Market): TypeName {
    self.quote.coin_type
}

/// Returns the cached base asset decimals.
public fun base_decimals(self: &Market): u8 {
    self.base.decimals
}

/// Returns the cached quote asset decimals.
public fun quote_decimals(self: &Market): u8 {
    self.quote.decimals
}

/// Returns the Pyth base asset price feed ID bytes.
public fun base_pyth_price_feed_id(self: &Market): vector<u8> {
    self.base.pyth_price_feed_id
}

/// Returns the Pyth quote asset price feed ID bytes.
public fun quote_pyth_price_feed_id(self: &Market): vector<u8> {
    self.quote.pyth_price_feed_id
}

/// Checks whether the price info object contains a Pyth base asset price feed ID matching the
/// configured market.
public fun has_valid_base_pyth_feed_id(self: &Market, price_info_object: &PriceInfoObject): bool {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    let actual_price_feed_id = price_info.get_price_identifier().get_bytes();
    actual_price_feed_id == self.base.pyth_price_feed_id
}

/// Checks whether the price info object contains a Pyth quote asset price feed ID matching the
/// configured market.
public fun has_valid_quote_pyth_feed_id(self: &Market, price_info_object: &PriceInfoObject): bool {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    let actual_price_feed_id = price_info.get_price_identifier().get_bytes();
    actual_price_feed_id == self.quote.pyth_price_feed_id
}

/// Returns the latest base price publish time in seconds, if any.
public fun base_price_publish_time(self: &Market): Option<u64> {
    self.base.price_publish_time
}

/// Returns the latest quote price publish time in seconds, if any.
public fun quote_price_publish_time(self: &Market): Option<u64> {
    self.quote.price_publish_time
}

// === Package Functions ===

/// Attempts to advance the cached base and quote publish times to the incoming price
/// timestamps.
/// Returns `true` when at least one feed advanced.
/// Returns `false` when both feeds are stale (no cache mutation).
/// The caller is expected to skip any downstream refresh work when this returns `false`.
public(package) fun try_update_publish_time(
    self: &mut Market,
    base_price: Price,
    quote_price: Price,
): bool {
    let base_price_ts = base_price.get_timestamp();
    let update_base_price_ts = self
        .base
        .price_publish_time
        .map!(|publish_time| publish_time < base_price_ts)
        .destroy_or!(true);
    if (update_base_price_ts) {
        self.base.price_publish_time.swap_or_fill(base_price_ts);
    };

    let quote_price_ts = quote_price.get_timestamp();
    let update_quote_price_ts = self
        .quote
        .price_publish_time
        .map!(|publish_time| publish_time < quote_price_ts)
        .destroy_or!(true);
    if (update_quote_price_ts) {
        self.quote.price_publish_time.swap_or_fill(quote_price_ts);
    };

    update_base_price_ts || update_quote_price_ts
}

/// Clears cached base and quote price publish timestamps so the next oracle read is not
/// treated as stale/replayed.
public(package) fun reset_price_publish_times(self: &mut Market) {
    self.base.price_publish_time = option::none();
    self.quote.price_publish_time = option::none();
}

/// Derive the DeepBook base/quote price and the combined confidence-to-price ratio (in basis
/// points) from base and quote USD prices, adjusted for the cached base/quote asset decimals.
///
/// The returned confidence ratio is the linear propagation of uncertainty through the ratio:
/// `Base/Quote = (Base/USD) / (Quote/USD)` => `d(mid)/mid ≈ d_base/base + d_quote/quote`
/// Each constituent conf_ratio is also individually bounded by `max_conf_ratio_bps`.
public(package) fun deepbook_price(
    self: &Market,
    base_price: Price,
    quote_price: Price,
    max_conf_ratio_bps: u64,
): (u64, u64) {
    let (base_mantissa, base_exponent, base_conf_ratio_bps) = deepbook_usd_price(
        base_price,
        max_conf_ratio_bps,
    );
    let (quote_mantissa, quote_exponent, quote_conf_ratio_bps) = deepbook_usd_price(
        quote_price,
        max_conf_ratio_bps,
    );

    // Convert (Base/USD)/(Quote/USD) to DeepBook price units (quote atoms per base atom).
    let base_mantissa = base_mantissa as u128;
    let quote_mantissa = quote_mantissa as u128;
    let price = base_mantissa * constants::float_scaling_u128() / quote_mantissa;

    // Include decimal adjustment for token precision mismatch.
    let quote_total = quote_exponent + self.quote.decimals;
    let base_total = base_exponent + self.base.decimals;
    let price = if (quote_total >= base_total) {
        price.checked_mul(10_u128.pow(quote_total - base_total)).destroy_or!(abort EPriceOverflow)
    } else {
        price / 10_u128.pow(base_total - quote_total)
    };
    let price = price.try_as_u64().destroy_or!(abort EPriceOverflow);

    assert!(price >= constants::min_price(), EPriceUnderflow);
    assert!(price <= constants::max_price(), EPriceOverflow);

    (price, base_conf_ratio_bps + quote_conf_ratio_bps)
}

// === Private Functions ===

/// Extract positive USD mantissa, negative exponent, and the fractional confidence-to-price ratio
/// in basis points from a Pyth price.
/// Aborts if the confidence interval exceeds `max_conf_ratio_bps` of the mantissa.
fun deepbook_usd_price(price: Price, max_conf_ratio_bps: u64): (u64, u8, u64) {
    // Retrieve positive mantissa.
    let price_i64 = price.get_price();
    assert!(!price_i64.get_is_negative(), EPythPriceNonPositive);
    let mantissa = price_i64.get_magnitude_if_positive();
    assert!(mantissa != 0, EPythPriceNonPositive);

    // Compute the confidence-to-price ratio in basis points and reject prices whose
    // confidence interval is too wide.
    let price_conf = price.get_conf() as u128;
    let conf_ratio_bps = (price_conf * HUNDRED_PERCENT_BPS_U128) / (mantissa as u128);
    assert!(conf_ratio_bps <= max_conf_ratio_bps as u128, EPythPriceConfidenceTooWide);
    let conf_ratio_bps = conf_ratio_bps as u64;

    // Retrieve negative exponent.
    let expo_i64 = price.get_expo();
    assert!(expo_i64.get_is_negative(), EPythExponentNonNegative);
    let exponent = expo_i64
        .get_magnitude_if_negative()
        .try_as_u8()
        .destroy_or!(abort EExponentTooLarge);
    assert!(exponent <= MAX_DECIMAL_POWER, EExponentTooLarge);

    (mantissa, exponent, conf_ratio_bps)
}

// === Test-Only Helpers ===

/// Returns the required Pyth price feed identifier length.
#[test_only]
public(package) fun pyth_price_identifier_length(): u64 {
    PYTH_PRICE_IDENTIFIER_LENGTH
}
