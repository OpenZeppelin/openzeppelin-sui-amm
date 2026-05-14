/// Per-market-maker executor accounting information.
module openzeppelin_market_maker::info;

// === Structs ===

/// Per-market-maker executor accounting information snapshot
/// recorded from the last quote refresh, withdrawal, or deposit.
public struct Info has drop, store {
    /// Cumulative base-asset volume traded within current epoch.
    volume_base: u128,
    /// Base-asset accounting (balance + cumulative deposits/withdrawals).
    base: CurrencyInfo,
    /// Quote-asset accounting (balance + cumulative deposits/withdrawals).
    quote: CurrencyInfo,
}

/// Per-asset cumulative balance/deposit/withdraw accounting for one side of the pair.
public struct CurrencyInfo has drop, store {
    /// Asset balance (reflected after the last quote update or deposit/withdraw).
    balance: u64,
    /// Cumulative amount deposited into the executor.
    deposited: u128,
    /// Cumulative amount withdrawn from the executor.
    withdrawn: u128,
}

// === Public Functions ===

/// Cumulative base-asset volume within current epoch
public fun volume_base(self: &Info): u128 {
    self.volume_base
}

/// Quote-asset balance (reflected after quote update)
public fun quote_balance(self: &Info): u64 {
    self.quote.balance
}

/// Base-asset balance (reflected after quote update)
public fun base_balance(self: &Info): u64 {
    self.base.balance
}

/// Cumulative quote-asset deposits into the executor.
public fun quote_deposited(self: &Info): u128 {
    self.quote.deposited
}

/// Cumulative base-asset deposits into the executor.
public fun base_deposited(self: &Info): u128 {
    self.base.deposited
}

/// Cumulative quote-asset withdrawals from the executor.
public fun quote_withdrawn(self: &Info): u128 {
    self.quote.withdrawn
}

/// Cumulative base-asset withdrawals from the executor.
public fun base_withdrawn(self: &Info): u128 {
    self.base.withdrawn
}

// === Package Functions ===

/// Create a zero-initialized `Info`.
public(package) fun empty(): Info {
    Info {
        volume_base: 0,
        base: CurrencyInfo { balance: 0, deposited: 0, withdrawn: 0 },
        quote: CurrencyInfo { balance: 0, deposited: 0, withdrawn: 0 },
    }
}

/// Update volume and balances.
public(package) fun update(
    self: &mut Info,
    volume_base: u128,
    quote_balance: u64,
    base_balance: u64,
) {
    self.volume_base = volume_base;
    self.base.balance = base_balance;
    self.quote.balance = quote_balance;
}

/// Record a quote-asset deposit amount.
/// Will never fail, but can record invalid value (u64::MAX).
public(package) fun record_quote_deposit(self: &mut Info, amount: u64) {
    self.quote.deposited = self.quote.deposited.saturating_add(amount as u128);
    self.quote.balance = self.quote.balance.saturating_add(amount);
}

/// Record a base-asset deposit amount.
/// Will never fail, but can record invalid value (u64::MAX).
public(package) fun record_base_deposit(self: &mut Info, amount: u64) {
    self.base.deposited = self.base.deposited.saturating_add(amount as u128);
    self.base.balance = self.base.balance.saturating_add(amount);
}

/// Record a quote-asset withdrawal amount.
/// Will never fail, but can record invalid balance (0) or withdrawal counter (u64::MAX).
/// Balances math should be considered independently when calling this function.
public(package) fun record_quote_withdraw(self: &mut Info, amount: u64) {
    self.quote.withdrawn = self.quote.withdrawn.saturating_add(amount as u128);
    self.quote.balance = self.quote.balance.saturating_sub(amount);
}

/// Record a base-asset withdrawal amount.
/// Will never fail, but can record invalid balance (0) or withdrawal counter (u64::MAX).
/// Balances math should be considered independently when calling this function.
public(package) fun record_base_withdraw(self: &mut Info, amount: u64) {
    self.base.withdrawn = self.base.withdrawn.saturating_add(amount as u128);
    self.base.balance = self.base.balance.saturating_sub(amount);
}
