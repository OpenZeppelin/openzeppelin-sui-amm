#[test_only]
module openzeppelin_market_maker::test_helpers;

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