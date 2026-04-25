module local_mock_pyth::price_info;

use local_mock_pyth::i64;
use local_mock_pyth::price;
use local_mock_pyth::price_feed::{Self, PriceFeed};
use local_mock_pyth::price_identifier::{Self, PriceIdentifier};
use local_mock_pyth::state::{Self, State};
use sui::clock::Clock;

// === Structs ===

/// Simplified price info object for localnet tests.
public struct PriceInfoObject has key, store {
    /// Unique ID for the shared object.
    id: UID,
    /// Price info snapshot payload.
    price_info: PriceInfo,
}

/// Snapshot of a price feed and its timestamps.
public struct PriceInfo has copy, drop, store {
    /// Attestation timestamp in seconds.
    attestation_time: u64,
    /// Arrival timestamp in seconds.
    arrival_time: u64,
    /// Associated price feed data.
    price_feed: PriceFeed,
}

// === Public Functions ===

public fun new_price_info(
    attestation_time: u64,
    arrival_time: u64,
    price_feed: PriceFeed,
): PriceInfo {
    PriceInfo {
        attestation_time,
        arrival_time,
        price_feed,
    }
}

public(package) fun new_price_info_object(
    price_info: PriceInfo,
    ctx: &mut TxContext,
): PriceInfoObject {
    PriceInfoObject {
        id: object::new(ctx),
        price_info,
    }
}

public(package) fun update_price_info_object(
    price_info_object: &mut PriceInfoObject,
    price_info: &PriceInfo,
) {
    price_info_object.price_info =
        new_price_info(
            price_info.attestation_time,
            price_info.arrival_time,
            price_info.price_feed,
        );
}

public(package) fun current_timestamp_seconds(clock: &Clock): u64 {
    clock.timestamp_ms() / 1000
}

/// Publish and share a new mock price feed on localnet, and register it in
/// the `State`'s feed table so `@pythnetwork/pyth-sui-js`'s
/// `getPriceFeedObjectId(feedId)` can resolve it.
public fun publish_price_feed(
    state: &mut State,
    feed_id: vector<u8>,
    price_magnitude: u64,
    price_is_negative: bool,
    confidence: u64,
    exponent_magnitude: u64,
    exponent_is_negative: bool,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let price_identifier = price_identifier::from_byte_vec(feed_id);
    let current_timestamp_seconds = current_timestamp_seconds(clock);
    let price_value = price::new(
        i64::new(price_magnitude, price_is_negative),
        confidence,
        i64::new(exponent_magnitude, exponent_is_negative),
        current_timestamp_seconds,
    );
    let price_feed = price_feed::new(price_identifier, price_value, price_value);
    let price_info = new_price_info(
        current_timestamp_seconds,
        current_timestamp_seconds,
        price_feed,
    );
    let price_info_object = new_price_info_object(price_info, ctx);

    // Register the new PriceInfoObject in the State's feed table.
    let table = state::price_info_table_mut(state);
    table.add(price_identifier, price_info_object.id.to_inner());

    transfer::share_object(price_info_object);
}

/// Update an existing mock price feed with fresh timestamps and values.
public fun update_price_feed(
    price_info_object: &mut PriceInfoObject,
    price_magnitude: u64,
    price_is_negative: bool,
    confidence: u64,
    exponent_magnitude: u64,
    exponent_is_negative: bool,
    clock: &Clock,
) {
    let price_identifier = get_price_feed(&price_info_object.price_info).get_price_identifier();
    let current_timestamp_seconds = current_timestamp_seconds(clock);
    let price_value = price::new(
        i64::new(price_magnitude, price_is_negative),
        confidence,
        i64::new(exponent_magnitude, exponent_is_negative),
        current_timestamp_seconds,
    );
    let price_feed = price_feed::new(price_identifier, price_value, price_value);
    price_info_object.price_info =
        new_price_info(
            current_timestamp_seconds,
            current_timestamp_seconds,
            price_feed,
        );
}

// === View helpers ===

public fun uid_to_inner(price_info_object: &PriceInfoObject): ID {
    price_info_object.id.to_inner()
}

public fun get_price_info_from_price_info_object(price_info_object: &PriceInfoObject): PriceInfo {
    price_info_object.price_info
}

public fun get_price_identifier(price_info: &PriceInfo): PriceIdentifier {
    price_info.price_feed.get_price_identifier()
}

public fun get_price_feed(price_info: &PriceInfo): &PriceFeed {
    &price_info.price_feed
}

public fun get_attestation_time(price_info: &PriceInfo): u64 {
    price_info.attestation_time
}

public fun get_arrival_time(price_info: &PriceInfo): u64 {
    price_info.arrival_time
}

// === Test-Only Helpers ===

#[test_only]
public fun new_price_info_object_for_test(
    price_info: PriceInfo,
    ctx: &mut TxContext,
): PriceInfoObject {
    new_price_info_object(price_info, ctx)
}
