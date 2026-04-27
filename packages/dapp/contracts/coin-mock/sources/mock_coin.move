module local_mock_coin::mock_coin;

use sui::coin_registry;

// === Constants ===

/// Fixed supply minted at initialization and transferred to `recipient`.
const MOCK_COIN_SUPPLY: u64 = 1_000_000_000_000_000_000;

// === Structs ===

/// Dev/local-only mock USD coin. Published for localnet convenience.
public struct USDC has key, store {
    /// Unique ID for the coin object.
    id: UID,
}

// === Public Functions ===

/// Initializes the local mock USDC currency.
///
/// This can only be called once per `(USDC, CoinRegistry)` pair because
/// each currency is a unique object derived from the type and the registry.
/// Any subsequent initialization attempt for the same pair will fail.
///
/// The type itself participates in runtime address
/// derivation even when no values of that type exist yet.
entry fun init_usdc(
    registry: &mut coin_registry::CoinRegistry,
    recipient: address,
    ctx: &mut TxContext,
) {
    let (init, mut treasury_cap) = coin_registry::new_currency<USDC>(
        registry,
        6,
        b"USDC".to_string(),
        b"USD Coin (mock)".to_string(),
        b"Local mock USDC for development only.".to_string(),
        b"".to_string(),
        ctx,
    );
    let metadata_cap = coin_registry::finalize(init, ctx);
    let minted = treasury_cap.mint(MOCK_COIN_SUPPLY, ctx);

    transfer::public_transfer(treasury_cap, recipient);
    transfer::public_transfer(metadata_cap, recipient);
    transfer::public_transfer(minted, recipient);
}
