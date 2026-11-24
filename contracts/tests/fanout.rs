//! Regression tests for multi-recipient fan-out streams (issue #674).
//!
//! These tests exercise the public client API against a real SAC token, so they
//! cover the funding transfer, per-child stream records, the group event, the
//! all-or-none cancel and the refund math — not just the storage layout.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token, Address, Env, IntoVal, Vec,
};
use stellar_stream::{
    fanout::{FanoutStreamCreated, MAX_FANOUT_RECIPIENTS},
    DataKey, StellarStreamContract, StellarStreamContractClient,
};

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

/// Registers + initializes the contract and funds `sender` with `minted`.
fn setup(env: &Env, minted: i128) -> (StellarStreamContractClient<'_>, Address, Address, Address) {
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let sender = Address::generate(env);
    let token = create_token(env, &admin);
    client.initialize(&admin, &token, &soroban_sdk::vec![env, token.clone()]);
    token::StellarAssetClient::new(env, &token).mint(&sender, &minted);

    (client, contract_id, sender, token)
}

fn allocations(env: &Env, entries: &[(Address, u64)]) -> Vec<(Address, u64)> {
    let mut recipients = Vec::new(env);
    for entry in entries.iter() {
        recipients.push_back((entry.0.clone(), entry.1));
    }
    recipients
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

#[test]
fn create_fanout_stream_funds_each_recipient_and_records_child_streams() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let (client, contract_id, sender, token) = setup(&env, 1_000);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let recipients = allocations(
        &env,
        &[
            (alice.clone(), 250),
            (bob.clone(), 350),
            (carol.clone(), 400),
        ],
    );

    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &1_000);

    let fanout = client.get_fanout_stream(&fanout_id);
    assert_eq!(fanout.id, fanout_id);
    assert_eq!(fanout.sender, sender);
    assert_eq!(fanout.token, token);
    assert_eq!(fanout.total_amount, 1_000);
    assert_eq!(fanout.start_time, 1_000);
    assert_eq!(fanout.end_time, 2_000);
    assert_eq!(fanout.stream_ids.len(), 3);
    assert!(!fanout.canceled);

    // One funding transfer moved exactly the summed allocations into escrow.
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    let alice_stream = client.get_stream(&fanout.stream_ids.get(0).unwrap());
    assert_eq!(alice_stream.recipient, alice);
    assert_eq!(alice_stream.sender, sender);
    assert_eq!(alice_stream.token, token);
    assert_eq!(alice_stream.total_amount, 250);
    assert_eq!(alice_stream.claimed_amount, 0);
    assert_eq!(alice_stream.start_time, 1_000);
    assert_eq!(alice_stream.end_time, 2_000);
    assert_eq!(alice_stream.cliff_seconds, 0);
    assert!(!alice_stream.canceled);

    let bob_stream = client.get_stream(&fanout.stream_ids.get(1).unwrap());
    assert_eq!(bob_stream.recipient, bob);
    assert_eq!(bob_stream.total_amount, 350);

    let carol_stream = client.get_stream(&fanout.stream_ids.get(2).unwrap());
    assert_eq!(carol_stream.recipient, carol);
    assert_eq!(carol_stream.total_amount, 400);

    // Each child is a normal stream: it vests over the shared duration.
    assert_eq!(
        client.claimable(&fanout.stream_ids.get(0).unwrap(), &2_000),
        250
    );
}

#[test]
fn create_fanout_stream_emits_group_event_with_sub_stream_ids() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(500);

    let (client, _contract_id, sender, token) = setup(&env, 300);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let recipients = allocations(&env, &[(alice.clone(), 100), (bob.clone(), 200)]);

    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &600);
    let fanout = client.get_fanout_stream(&fanout_id);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(
        last_event.1,
        (symbol_short!("Fanout"), symbol_short!("Created")).into_val(&env)
    );

    let event_data: FanoutStreamCreated = last_event.2.into_val(&env);
    assert_eq!(event_data.fanout_id, fanout_id);
    assert_eq!(event_data.actor, sender);
    assert_eq!(event_data.sender, sender);
    assert_eq!(event_data.token, token);
    assert_eq!(event_data.total_amount, 300);
    assert_eq!(event_data.start_time, 500);
    assert_eq!(event_data.end_time, 1_100);
    assert_eq!(event_data.stream_ids, fanout.stream_ids);
}

#[test]
fn create_fanout_stream_accepts_the_maximum_of_ten_recipients() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(0);

    let (client, _contract_id, sender, token) = setup(&env, 1_000);

    let mut entries = std::vec::Vec::new();
    for _ in 0..MAX_FANOUT_RECIPIENTS {
        entries.push((Address::generate(&env), 100));
    }
    let recipients = allocations(&env, &entries);

    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &100);
    let fanout = client.get_fanout_stream(&fanout_id);
    assert_eq!(fanout.stream_ids.len(), MAX_FANOUT_RECIPIENTS);
    assert_eq!(fanout.total_amount, 1_000);
}

#[test]
#[should_panic(expected = "too many recipients")]
fn create_fanout_stream_rejects_more_than_ten_recipients() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, sender, token) = setup(&env, 1_000);

    let mut entries = std::vec::Vec::new();
    for _ in 0..(MAX_FANOUT_RECIPIENTS + 1) {
        entries.push((Address::generate(&env), 100));
    }
    let recipients = allocations(&env, &entries);

    client.create_fanout_stream(&sender, &recipients, &token, &100);
}

#[test]
#[should_panic(expected = "recipients must not be empty")]
fn create_fanout_stream_rejects_an_empty_recipient_list() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, sender, token) = setup(&env, 1_000);
    let recipients = Vec::<(Address, u64)>::new(&env);

    client.create_fanout_stream(&sender, &recipients, &token, &100);
}

#[test]
#[should_panic(expected = "duration must be positive")]
fn create_fanout_stream_rejects_zero_duration() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, sender, token) = setup(&env, 1_000);
    let recipients = allocations(&env, &[(Address::generate(&env), 100)]);

    client.create_fanout_stream(&sender, &recipients, &token, &0);
}

#[test]
#[should_panic(expected = "allocation must be positive")]
fn create_fanout_stream_rejects_a_zero_allocation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, sender, token) = setup(&env, 1_000);
    let recipients = allocations(
        &env,
        &[(Address::generate(&env), 100), (Address::generate(&env), 0)],
    );

    client.create_fanout_stream(&sender, &recipients, &token, &100);
}

#[test]
#[should_panic(expected = "insufficient sender balance")]
fn create_fanout_stream_funds_the_exact_sum_of_allocations() {
    let env = Env::default();
    env.mock_all_auths();

    // Allocations sum to 1_001 but only 1_000 is available: the fan-out must
    // not partially fund or silently round down.
    let (client, _contract_id, sender, token) = setup(&env, 1_000);
    let recipients = allocations(
        &env,
        &[
            (Address::generate(&env), 500),
            (Address::generate(&env), 501),
        ],
    );

    client.create_fanout_stream(&sender, &recipients, &token, &100);
}

// ---------------------------------------------------------------------------
// Atomic cancel
// ---------------------------------------------------------------------------

#[test]
fn cancel_fanout_stream_cancels_every_child_and_refunds_unvested_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let (client, contract_id, sender, token) = setup(&env, 1_000);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let dave = Address::generate(&env);
    let recipients = allocations(
        &env,
        &[
            (alice.clone(), 100),
            (bob.clone(), 200),
            (carol.clone(), 300),
            (dave.clone(), 400),
        ],
    );

    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &1_000);

    // 25% vested: 100→25, 200→50, 300→75, 400→100 = 250 vested, 750 refund.
    env.ledger().set_timestamp(1_250);
    let refunded = client.cancel_fanout_stream(&fanout_id, &sender);
    assert_eq!(refunded, 750);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 750);
    assert_eq!(token_client.balance(&contract_id), 250);

    let fanout = client.get_fanout_stream(&fanout_id);
    assert!(fanout.canceled);

    let expected = [(&alice, 25_i128), (&bob, 50), (&carol, 75), (&dave, 100)];
    for (index, (recipient, vested)) in expected.iter().enumerate() {
        let stream_id = fanout.stream_ids.get(index as u32).unwrap();
        let stream = client.get_stream(&stream_id);
        assert_eq!(&stream.recipient, *recipient);
        assert!(stream.canceled);
        assert_eq!(stream.end_time, 1_250);
        assert_eq!(stream.total_amount, *vested);
        // Vested funds stay claimable; nothing further vests after the cancel.
        assert_eq!(client.claimable(&stream_id, &2_000), *vested);
    }
}

#[test]
fn cancel_fanout_stream_preserves_claims_made_before_the_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(0);

    let (client, contract_id, sender, token) = setup(&env, 1_000);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let recipients = allocations(&env, &[(alice.clone(), 400), (bob.clone(), 600)]);
    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &1_000);
    let alice_stream_id = client
        .get_fanout_stream(&fanout_id)
        .stream_ids
        .get(0)
        .unwrap();

    // Half-way: Alice claims her 200 vested tokens before the group is canceled.
    env.ledger().set_timestamp(500);
    client.claim(&alice_stream_id, &alice, &200);

    let refunded = client.cancel_fanout_stream(&fanout_id, &sender);
    // Alice: 400 total, 200 claimed → 200 refund. Bob: 600 → 300 refund.
    assert_eq!(refunded, 500);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&alice), 200);
    assert_eq!(token_client.balance(&sender), 500);
    assert_eq!(token_client.balance(&contract_id), 300);

    // Cancel shrinks the child to the gross vested amount (200), which Alice
    // has already claimed in full, so nothing further is claimable.
    let alice_stream = client.get_stream(&alice_stream_id);
    assert!(alice_stream.canceled);
    assert_eq!(alice_stream.claimed_amount, 200);
    assert_eq!(alice_stream.total_amount, 200);
    assert_eq!(client.claimable(&alice_stream_id, &1_000), 0);
}

#[test]
fn cancel_fanout_stream_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let (client, contract_id, sender, token) = setup(&env, 1_000);
    let recipients = allocations(
        &env,
        &[
            (Address::generate(&env), 500),
            (Address::generate(&env), 500),
        ],
    );
    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &1_000);

    env.ledger().set_timestamp(1_250);
    assert_eq!(client.cancel_fanout_stream(&fanout_id, &sender), 750);

    // A second cancel must not refund twice or emit another child event.
    assert_eq!(client.cancel_fanout_stream(&fanout_id, &sender), 0);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 750);
    assert_eq!(token_client.balance(&contract_id), 250);
    assert!(client.get_fanout_stream(&fanout_id).canceled);
}

#[test]
fn cancel_fanout_stream_skips_children_already_canceled_individually() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(0);

    let (client, contract_id, sender, token) = setup(&env, 1_000);
    let recipients = allocations(
        &env,
        &[
            (Address::generate(&env), 500),
            (Address::generate(&env), 500),
        ],
    );
    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &1_000);
    let stream_ids = client.get_fanout_stream(&fanout_id).stream_ids;

    // Cancel one child on its own at 25% vested: 125 vests, 375 is refunded.
    env.ledger().set_timestamp(250);
    client.cancel(&stream_ids.get(0).unwrap(), &sender);

    // The group cancel settles only the remaining child (another 375 refund)
    // and must not refund the already-canceled child a second time.
    let refunded = client.cancel_fanout_stream(&fanout_id, &sender);
    assert_eq!(refunded, 375);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 750);
    assert_eq!(token_client.balance(&contract_id), 250);
    assert!(client.get_fanout_stream(&fanout_id).canceled);
}

#[test]
#[should_panic(expected = "sender mismatch")]
fn cancel_fanout_stream_rejects_a_non_sender() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, sender, token) = setup(&env, 1_000);
    let recipients = allocations(&env, &[(Address::generate(&env), 500)]);
    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &1_000);

    client.cancel_fanout_stream(&fanout_id, &Address::generate(&env));
}

/// A fan-out cancel is all-or-none: if a later child cannot be settled, the
/// refunds and `canceled` flags already written for earlier children must roll
/// back with the failed transaction.
#[test]
fn cancel_fanout_stream_rolls_back_every_child_when_settlement_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(0);

    let (client, contract_id, sender, token) = setup(&env, 1_000);
    let recipients = allocations(
        &env,
        &[
            (Address::generate(&env), 200),
            (Address::generate(&env), 300),
            (Address::generate(&env), 500),
        ],
    );
    let fanout_id = client.create_fanout_stream(&sender, &recipients, &token, &1_000);
    let stream_ids = client.get_fanout_stream(&fanout_id).stream_ids;
    let settled_first = stream_ids.get(0).unwrap();
    let last = stream_ids.get(2).unwrap();

    // Simulate a corrupt child record: the cancel loop settles the first child,
    // then panics on the missing one.
    env.as_contract(&contract_id, || {
        env.storage().persistent().remove(&DataKey::Stream(last));
    });
    env.ledger().set_timestamp(250);

    assert!(client
        .try_cancel_fanout_stream(&fanout_id, &sender)
        .is_err());

    let token_client = token::Client::new(&env, &token);
    assert!(!client.get_stream(&settled_first).canceled);
    assert!(!client.get_fanout_stream(&fanout_id).canceled);
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);
}
