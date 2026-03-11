module pyth::pyth;

use pyth::price::{Self, Price};
use pyth::price_feed;
use pyth::price_info::{Self, PriceInfoObject};
use sui::clock::{Self, Clock};

// === Constants ===

const EStalePriceUpdate: u64 = 0;

// === Public Functions ===

/// Return the cached price if it is newer than `max_age_secs` relative to the on-chain clock.
public fun get_price_no_older_than(
    price_info_object: &PriceInfoObject,
    clock: &Clock,
    max_age_secs: u64,
): Price {
    let price = get_price_unsafe(price_info_object);
    check_price_is_fresh(&price, clock, max_age_secs);
    price
}

/// Return the cached price without any freshness check.
public fun get_price_unsafe(price_info_object: &PriceInfoObject): Price {
    let price_info = price_info::get_price_info_from_price_info_object(price_info_object);
    price_feed::get_price(price_info::get_price_feed(&price_info))
}

// === Private Functions ===

fun abs_diff(x: u64, y: u64): u64 {
    if (x > y) {
        x - y
    } else {
        y - x
    }
}

fun check_price_is_fresh(price: &Price, clock: &Clock, max_age_secs: u64) {
    let age = abs_diff(clock::timestamp_ms(clock) / 1000, price::get_timestamp(price));
    assert!(age < max_age_secs, EStalePriceUpdate);
}
