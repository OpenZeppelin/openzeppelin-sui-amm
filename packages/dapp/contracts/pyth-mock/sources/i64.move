module local_mock_pyth::i64;

// === Errors ===
#[error(code = 0)]
const EMagnitudeTooLarge: vector<u8> = "Magnitude exceeds maximum allowed value";

#[error(code = 1)]
const ENotPositive: vector<u8> = "Expected a positive I64 value";

#[error(code = 2)]
const ENotNegative: vector<u8> = "Expected a negative I64 value";

// === Constants ===

// As Move does not support signed integers, this module wraps a magnitude with a sign bit.
const MAX_POSITIVE_MAGNITUDE: u64 = (1 << 63) - 1;
const MAX_NEGATIVE_MAGNITUDE: u64 = 1 << 63;

// === Structs ===

/// Signed 64-bit integer representation.
public struct I64 has copy, drop, store {
    /// Whether the value is negative.
    negative: bool,
    /// Absolute value magnitude.
    magnitude: u64,
}

// === Public Functions ===

public fun new(magnitude: u64, negative: bool): I64 {
    let max_magnitude = if (negative) {
        MAX_NEGATIVE_MAGNITUDE
    } else {
        MAX_POSITIVE_MAGNITUDE
    };
    assert!(magnitude <= max_magnitude, EMagnitudeTooLarge);

    let normalized_negative = if (magnitude == 0) { false } else { negative };

    I64 {
        magnitude,
        negative: normalized_negative,
    }
}

public fun get_is_negative(i: &I64): bool {
    i.negative
}

public fun get_magnitude_if_positive(input: &I64): u64 {
    assert!(!input.negative, ENotPositive);
    input.magnitude
}

public fun get_magnitude_if_negative(input: &I64): u64 {
    assert!(input.negative, ENotNegative);
    input.magnitude
}

public fun from_u64(from: u64): I64 {
    let negative = (from >> 63) == 1;
    let magnitude = parse_magnitude(from, negative);

    new(magnitude, negative)
}

// === Private Functions ===

fun parse_magnitude(from: u64, negative: bool): u64 {
    if (!negative) {
        return from
    };

    let inverted = from ^ 0xFFFFFFFFFFFFFFFF;
    inverted + 1
}
