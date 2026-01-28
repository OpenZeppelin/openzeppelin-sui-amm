module mock_coin::mock_coin;

use sui::coin;
use sui::coin_registry;

/// Dev/local-only mock USD coin. Published for localnet convenience.
public struct LocalMockUsd has key, store {
    id: UID,
}

/// Fixed supply minted at initialization and transferred to `recipient`.
const MOCK_COIN_SUPPLY: u64 = 1_000_000_000_000_000_000;

/// Initializes the local mock USD currency.
///
/// This can only be called once per `(LocalMockUsd, CoinRegistry)` pair because
/// each currency is a unique object derived from the type and the registry.
/// Any subsequent initialization attempt for the same pair will fail.
///
/// The type itself participates in runtime address
/// derivation even when no values of that type exist yet.
entry fun init_local_mock_usd(
    registry: &mut coin_registry::CoinRegistry,
    recipient: address,
    ctx: &mut TxContext,
) {
    let (init, treasury_cap) = coin_registry::new_currency<LocalMockUsd>(
        registry,
        6,
        b"USDc".to_string(),
        b"Local Mock USD".to_string(),
        b"Local mock asset for development only.".to_string(),
        b"".to_string(),
        ctx,
    );
    finalize_and_fund_coin(treasury_cap, init, recipient, ctx);
}

/// Finalizes metadata, mints the fixed supply, and transfers all caps/coins.
fun finalize_and_fund_coin<T: key + store>(
    mut treasury_cap: coin::TreasuryCap<T>,
    init: coin_registry::CurrencyInitializer<T>,
    recipient: address,
    ctx: &mut TxContext,
) {
    let metadata_cap = coin_registry::finalize(init, ctx);
    let minted = treasury_cap.mint(MOCK_COIN_SUPPLY, ctx);

    transfer::public_transfer(treasury_cap, recipient);
    transfer::public_transfer(metadata_cap, recipient);
    transfer::public_transfer(minted, recipient);
}
