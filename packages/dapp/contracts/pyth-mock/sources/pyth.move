module local_mock_pyth::pyth;

use local_mock_pyth::price::Price;
use local_mock_pyth::price_info::{Self, PriceInfoObject};
use sui::clock::Clock;

// === Errors ===

#[error(code = 0)]
const EStalePriceUpdate: vector<u8> = "price update is stale";

// === Public Functions ===

/// Return the cached price if it is newer than `max_age_secs` relative to the on-chain clock.
public fun get_price_no_older_than(
    price_info_object: &PriceInfoObject,
    clock: &Clock,
    max_age_secs: u64,
): Price {
    let price = get_price_unsafe(price_info_object);
    assert_price_age_within_limit(&price, clock, max_age_secs);
    price
}

/// Return the cached price without any freshness check.
public fun get_price_unsafe(price_info_object: &PriceInfoObject): Price {
    let price_info = price_info_object.get_price_info_from_price_info_object();
    price_info.get_price_feed().get_price()
}

// === Private Functions ===

fun abs_diff(x: u64, y: u64): u64 {
    if (x > y) {
        x - y
    } else {
        y - x
    }
}

fun assert_price_age_within_limit(price: &Price, clock: &Clock, max_age_secs: u64) {
    let current_timestamp_seconds = price_info::current_timestamp_seconds(clock);
    let age = abs_diff(current_timestamp_seconds, price.get_timestamp());
    assert!(age < max_age_secs, EStalePriceUpdate);
}
