/// Per-market-maker accounting info.
module openzeppelin_market_maker::info;

// === Structs ===

/// Per-market-maker accounting snapshot.
public struct Info has drop, store {
    /// Cumulative base-asset volume traded within current epoch.
    volume_base: u128,
    /// Quote-asset balance accounting.
    quote_balance: u64,
    /// Base-asset balance accounting.
    base_balance: u64,
}

// === Public Functions ===

/// Cumulative base-asset volume within current epoch
public fun volume_base(self: &Info): u128 {
    self.volume_base
}

/// Quote-asset balance (reflected after quote update)
public fun quote_balance(self: &Info): u64 {
    self.quote_balance
}

/// Base-asset balance (reflected after quote update)
public fun base_balance(self: &Info): u64 {
    self.base_balance
}

// === Public Package Functions ===

/// Create a zero-initialized `Info`.
public(package) fun empty(): Info {
    Info {
        volume_base: 0,
        quote_balance: 0,
        base_balance: 0,
    }
}

/// Set cumulative base-asset volume.
public(package) fun set_volume_base(self: &mut Info, volume_base: u128) {
    self.volume_base = volume_base;
}

/// Set quote-asset balance.
public(package) fun set_quote_balance(self: &mut Info, quote_balance: u64) {
    self.quote_balance = quote_balance;
}

/// Set base-asset balance.
public(package) fun set_base_balance(self: &mut Info, base_balance: u64) {
    self.base_balance = base_balance;
}
