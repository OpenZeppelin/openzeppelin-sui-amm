module simple_contract::counter;

use std::string;
use sui::event;

const EInvalidOwnerCap: u64 = 1;

public struct Counter has key {
  id: UID,
  label: string::String,
  owner: address,
  disabled: bool,
}

public struct CounterOwnerCap has key {
  id: UID,
  counter_id: address,
}

public struct CounterCreated has copy, drop {
  counter_id: address,
  counter_owner_cap_id: address,
  owner: address,
  label: vector<u8>,
}

public struct CounterOwnerUpdated has copy, drop {
  counter_id: address,
  new_owner: address,
}

entry fun create_counter(label: vector<u8>, ctx: &mut TxContext) {
  let owner = tx_context::sender(ctx);
  let counter = Counter {
    id: object::new(ctx),
    label: string::utf8(label),
    owner,
    disabled: false,
  };
  let counter_id = object::uid_to_address(&counter.id);
  let owner_cap = CounterOwnerCap { id: object::new(ctx), counter_id };
  let owner_cap_id = object::uid_to_address(&owner_cap.id);

  transfer::share_object(counter);
  transfer::transfer(owner_cap, owner);
  event::emit(CounterCreated {
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
  event::emit(CounterOwnerUpdated { counter_id, new_owner });
}
