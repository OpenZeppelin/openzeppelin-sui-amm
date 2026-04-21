/// Per-market-maker executor accounting info.
module openzeppelin_market_maker::info;

// === Structs ===

/// Per-market-maker executor accounting snapshot.
public struct Info has drop, store {
    /// Cumulative base-asset volume traded within current epoch.
    volume_base: u128,
    /// Quote-asset balance accounting.
    quote_balance: u64,
    /// Base-asset balance accounting.
    base_balance: u64,
    /// Cumulative quote-asset amount deposited into the executor.
    quote_deposited: u64,
    /// Cumulative base-asset amount deposited into the executor.
    base_deposited: u64,
    /// Cumulative quote-asset amount withdrawn from the executor.
    quote_withdrawn: u64,
    /// Cumulative base-asset amount withdrawn from the executor.
    base_withdrawn: u64,
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

/// Cumulative quote-asset deposits into the executor.
public fun quote_deposited(self: &Info): u64 {
    self.quote_deposited
}

/// Cumulative base-asset deposits into the executor.
public fun base_deposited(self: &Info): u64 {
    self.base_deposited
}

/// Cumulative quote-asset withdrawals from the executor.
public fun quote_withdrawn(self: &Info): u64 {
    self.quote_withdrawn
}

/// Cumulative base-asset withdrawals from the executor.
public fun base_withdrawn(self: &Info): u64 {
    self.base_withdrawn
}

// === Public Package Functions ===

/// Create a zero-initialized `Info`.
public(package) fun empty(): Info {
    Info {
        volume_base: 0,
        quote_balance: 0,
        base_balance: 0,
        quote_deposited: 0,
        base_deposited: 0,
        quote_withdrawn: 0,
        base_withdrawn: 0,
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

/// Accumulate a quote-asset deposit amount.
public(package) fun add_quote_deposited(self: &mut Info, amount: u64) {
    self.quote_deposited = self.quote_deposited + amount;
}

/// Accumulate a base-asset deposit amount.
public(package) fun add_base_deposited(self: &mut Info, amount: u64) {
    self.base_deposited = self.base_deposited + amount;
}

/// Accumulate a quote-asset withdrawal amount.
public(package) fun add_quote_withdrawn(self: &mut Info, amount: u64) {
    self.quote_withdrawn = self.quote_withdrawn + amount;
}

/// Accumulate a base-asset withdrawal amount.
public(package) fun add_base_withdrawn(self: &mut Info, amount: u64) {
    self.base_withdrawn = self.base_withdrawn + amount;
}
