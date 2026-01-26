/// Execution-time state and events for the AMM.
module PropAmm::executor;

use sui::table::Table;

// === Structs ===

/// Per-trader account state.
public struct TraderAccount has key {
    /// Unique ID for the account object.
    id: UID,
    /// Account owner.
    owner: address,
    /// Active order IDs keyed by pool ID.
    active_orders: Table<ID, vector<ID>>,
}

// === Events ===

/// Emitted when a quote is updated.
public struct QuoteUpdatedEvent has copy, drop {
    /// Pool identifier.
    pool_id: ID,
    /// Quote price.
    price: u64,
    /// Spread in basis points.
    spread_bps: u64,
    /// Quote timestamp in milliseconds.
    timestamp_ms: u64,
}

/// Emitted when an order is executed.
public struct OrderExecutedEvent has copy, drop {
    /// Order identifier.
    order_id: ID,
    /// Execution price.
    fill_price: u64,
}
