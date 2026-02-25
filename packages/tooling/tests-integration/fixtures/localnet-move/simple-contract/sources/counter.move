module simple_contract::counter;

use std::string;
use sui::event;

// === Constants ===

const EInvalidOwnerCap: u64 = 1;

// === Structs ===

public struct Counter has key {
  /// Unique ID for the counter object.
  id: UID,
  /// Human-readable label.
  label: string::String,
  /// Current owner address.
  owner: address,
  /// Whether the counter is disabled.
  disabled: bool,
}

public struct CounterOwnerCap has key {
  /// Unique ID for the capability object.
  id: UID,
  /// Address of the associated counter.
  counter_id: address,
}

// === Events ===

public struct CounterCreatedEvent has copy, drop {
  /// Address of the newly created counter.
  counter_id: address,
  /// Address of the new owner capability.
  counter_owner_cap_id: address,
  /// Owner address.
  owner: address,
  /// Raw label bytes.
  label: vector<u8>,
}

public struct CounterOwnerUpdatedEvent has copy, drop {
  /// Address of the counter.
  counter_id: address,
  /// New owner address.
  new_owner: address,
}

// === Public Functions ===

entry fun create_counter(label: vector<u8>, ctx: &mut TxContext) {
  let owner = tx_context::sender(ctx);
  let counter = build_counter(label, owner, ctx);
  let counter_id = object::uid_to_address(&counter.id);
  let owner_cap = CounterOwnerCap { id: object::new(ctx), counter_id };
  let owner_cap_id = object::uid_to_address(&owner_cap.id);

  share_counter(counter);
  transfer::transfer(owner_cap, owner);
  event::emit(CounterCreatedEvent {
    counter_id,
    counter_owner_cap_id: owner_cap_id,
    owner,
    label,
  });
}

entry fun update_counter_owner(
  counter: &mut Counter,
  owner_cap: CounterOwnerCap,
  new_owner: address,
) {
  let counter_id = object::uid_to_address(&counter.id);
  assert!(owner_cap.counter_id == counter_id, EInvalidOwnerCap);
  counter.owner = new_owner;
  transfer::transfer(owner_cap, new_owner);
  event::emit(CounterOwnerUpdatedEvent { counter_id, new_owner });
}

// === Private Functions ===

fun build_counter(label: vector<u8>, owner: address, ctx: &mut TxContext): Counter {
  Counter {
    id: object::new(ctx),
    label: string::utf8(label),
    owner,
    disabled: false,
  }
}

fun share_counter(counter: Counter) {
  transfer::share_object(counter);
}
