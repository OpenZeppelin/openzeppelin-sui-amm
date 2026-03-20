#[test_only]
module openzeppelin_market_maker::test_helpers;

use openzeppelin_market_maker::manager;

/// Asserts that `expected_event` of type `T` was emitted within current transaction
/// (before `test_scenario::next_tx`).
public(package) macro fun assert_emitted<$T>($expected_event: $T) {
    let events = sui::event::events_by_type<$T>();
    if (events.length() == 0) {
        std::debug::print(&b"Assertion failed. No events emitted.".to_string());
        abort
    };
    let emitted = events.any!(|event| event == $expected_event);
    if (!emitted) {
        std::debug::print(&b"Assertion failed. Different events emitted:".to_string());
        std::debug::print(&events);
        std::debug::print(&b"No matching events".to_string());
        abort
    };
}

/// Builds a dummy Pyth feed ID with a caller-provided byte value.
public(package) fun build_pyth_price_feed_id(byte_value: u8): vector<u8> {
    vector::tabulate!(manager::pyth_price_identifier_length(), |_| byte_value)
}

/// Builds a dummy Pyth feed ID with invalid length.
public(package) fun build_invalid_pyth_price_feed_id(): vector<u8> {
    vector::tabulate!(manager::pyth_price_identifier_length() - 1, |_| 0)
}
