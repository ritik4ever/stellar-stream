//! Claimable accounting and the existing event replay contract (#1132).
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, IntoVal,
};
use std::collections::BTreeSet;

struct Fixture {
    env: Env,
    contract: Address,
    sender: Address,
    recipient: Address,
    token: Address,
    id: u64,
}

impl Fixture {
    fn new(total: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let contract = env.register_contract(None, StellarStreamContract);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin).address();
        token::StellarAssetClient::new(&env, &token).mint(&sender, &total);
        let id = StellarStreamContractClient::new(&env, &contract)
            .create_stream(&sender, &recipient, &token, &total, &100, &103, &0, &None);
        Self {
            env,
            contract,
            sender,
            recipient,
            token,
            id,
        }
    }

    fn client(&self) -> StellarStreamContractClient<'_> {
        StellarStreamContractClient::new(&self.env, &self.contract)
    }

    fn at(&self, timestamp: u64) {
        self.env
            .ledger()
            .with_mut(|ledger| ledger.timestamp = timestamp);
    }

    fn events(&self) -> std::vec::Vec<(Symbol, Val)> {
        self.env
            .events()
            .all()
            .iter()
            .filter(|(emitter, _, _)| emitter == &self.contract)
            .map(|(_, topics, data)| (topics.get(1).unwrap().into_val(&self.env), data))
            .collect()
    }

    fn assert_accounting(&self, claimed: i128, claimable: i128) {
        let stream = self.client().get_stream(&self.id);
        let now = self.env.ledger().timestamp();
        assert_eq!(stream.claimed_amount, claimed);
        assert_eq!(self.client().claimable(&self.id, &now), claimable);
        let batch = self
            .client()
            .get_claimable_batch(&Vec::from_array(&self.env, [self.id]), &now);
        assert_eq!(batch.get(self.id), Some(claimable));
        assert!(claimable >= 0);
        assert!(claimed.checked_add(claimable).unwrap() <= stream.total_amount);
        assert_eq!(
            token::Client::new(&self.env, &self.token).balance(&self.recipient),
            claimed
        );
    }

    fn claim(&self, amount: i128, cumulative: i128, remaining: i128, complete: bool) {
        let before = self.events().len();
        assert_eq!(
            self.client().claim(&self.id, &self.recipient, &amount),
            amount
        );
        let events = self.events();
        let new_events = &events[before..];
        assert_eq!(new_events.len(), if complete { 2 } else { 1 });
        assert_eq!(new_events[0].0, symbol_short!("Claimed"));
        let claim: StreamClaimed = new_events[0].1.into_val(&self.env);
        assert_eq!(
            claim,
            StreamClaimed {
                stream_id: self.id,
                actor: self.recipient.clone(),
                timestamp: self.env.ledger().timestamp(),
                recipient: self.recipient.clone(),
                amount,
                claimed_amount: cumulative,
            }
        );
        if complete {
            assert_eq!(new_events[1].0, symbol_short!("Completed"));
            let completion: StreamCompleted = new_events[1].1.into_val(&self.env);
            assert_eq!(completion.stream_id, claim.stream_id);
            assert_eq!(completion.actor, claim.actor);
            assert_eq!(completion.timestamp, claim.timestamp);
            assert_eq!(completion.total_amount, cumulative);
        }
        self.assert_accounting(cumulative, remaining);
    }
}

#[test]
fn claimable_events_before_start_and_queries_have_no_committed_action() {
    let f = Fixture::new(10);
    for now in [99, 100] {
        f.at(now);
        let before = f.events().len();
        let stream = f.client().get_stream(&f.id);
        f.assert_accounting(0, 0);
        assert_eq!(
            f.events().len(),
            before,
            "read-only calculations emit no events"
        );
        assert!(f.client().try_claim(&f.id, &f.recipient, &1).is_err());
        assert_eq!(f.client().get_stream(&f.id), stream);
        assert_eq!(
            f.events().len(),
            before,
            "failed claims emit no committed stream events"
        );
        assert_eq!(
            token::Client::new(&f.env, &f.token).balance(&f.contract),
            10
        );
    }
}

#[test]
fn claimable_events_repeated_partial_claims_round_cumulatively_and_replay_once() {
    let f = Fixture::new(10);
    f.at(101); // floor(10 / 3) = 3, regardless of the number of claims.
    f.claim(1, 1, 2, false);
    f.claim(1, 2, 1, false); // Same timestamp and amount: a distinct action.
    f.at(102); // floor(20 / 3) = 6; the earlier claims consumed exactly 2.
    f.claim(4, 6, 0, false);
    f.at(103);
    f.claim(4, 10, 0, true); // All remaining dust is paid at the end.
    f.at(104);
    f.assert_accounting(10, 0);

    let events = f.events();
    let mut seen = BTreeSet::new();
    let mut transferred = 0;
    let mut projected_claimed = 0;
    // An ordinal stands in for the RPC event identity here. Replaying the same
    // page must not apply transfers twice or collapse two equal partial claims.
    for _ in 0..2 {
        for (event_id, (name, data)) in events.iter().enumerate() {
            if !seen.insert(event_id) {
                continue;
            }
            if *name == symbol_short!("Claimed") {
                let event: StreamClaimed = (*data).into_val(&f.env);
                assert_eq!(event.claimed_amount, projected_claimed + event.amount);
                transferred += event.amount;
                projected_claimed = event.claimed_amount;
            } else if *name == symbol_short!("Completed") {
                let event: StreamCompleted = (*data).into_val(&f.env);
                assert_eq!(projected_claimed, event.total_amount);
                // Completion is a status signal, not another transfer.
            }
        }
    }
    assert_eq!(transferred, 10);
    assert_eq!(
        projected_claimed,
        f.client().get_stream(&f.id).claimed_amount
    );
}

#[test]
fn claimable_events_one_base_unit_vests_at_end() {
    let f = Fixture::new(1);
    for now in [100, 101, 102] {
        f.at(now);
        f.assert_accounting(0, 0);
    }
    f.at(103);
    f.claim(1, 1, 0, true);
}

#[test]
fn claimable_events_cancel_cap_is_reconstructed_before_final_claim() {
    let f = Fixture::new(10);
    f.at(101);
    f.claim(1, 1, 2, false);
    let before = f.events().len();
    f.client().cancel(&f.id, &f.sender);
    let events = f.events();
    assert_eq!(events.len(), before + 1);
    assert_eq!(events[before].0, symbol_short!("Canceled"));
    let canceled: StreamCanceled = events[before].1.into_val(&f.env);
    assert_eq!(canceled.stream_id, f.id);
    assert_eq!(canceled.actor, f.sender);
    assert_eq!(canceled.sender, f.sender);
    assert_eq!(canceled.timestamp, 101);
    assert_eq!(canceled.refunded_amount, 7);
    let created: StreamCreated = events[0].1.into_val(&f.env);
    let projected_total = created.total_amount - canceled.refunded_amount;
    let stream = f.client().get_stream(&f.id);
    assert_eq!(stream.total_amount, projected_total);
    assert_eq!(stream.end_time, canceled.timestamp);
    assert_eq!(projected_total, 3);
    f.assert_accounting(1, 2);
    f.at(200);
    f.assert_accounting(1, 2);
    f.claim(2, 3, 0, true);
    assert_eq!(token::Client::new(&f.env, &f.token).balance(&f.sender), 7);
    let before = f.events().len();
    assert!(f.client().try_claim(&f.id, &f.recipient, &1).is_err());
    f.client().cancel(&f.id, &f.sender); // Idempotent cancellation has no new event.
    assert_eq!(f.events().len(), before);
}

#[test]
fn claimable_events_cancel_before_start_refunds_without_claim_or_completion() {
    let f = Fixture::new(10);
    f.at(99);
    f.client().cancel(&f.id, &f.sender);
    let events = f.events();
    assert_eq!(events.len(), 2); // Created, Canceled.
    assert_eq!(events[1].0, symbol_short!("Canceled"));
    let canceled: StreamCanceled = events[1].1.into_val(&f.env);
    assert_eq!(canceled.refunded_amount, 10);
    f.at(200);
    f.assert_accounting(0, 0);
    assert_eq!(f.client().get_stream(&f.id).total_amount, 0);
    assert_eq!(token::Client::new(&f.env, &f.token).balance(&f.sender), 10);
}

#[test]
fn claimable_events_failed_token_transfer_has_no_claim_accounting_or_event() {
    let f = Fixture::new(10);
    // Drain the escrow only in this fixture to make the real SAC transfer fail.
    f.env.as_contract(&f.contract, || {
        token::Client::new(&f.env, &f.token).burn(&f.contract, &10);
    });
    f.at(103);
    let before = f.events().len();
    let stream = f.client().get_stream(&f.id);
    assert!(f.client().try_claim(&f.id, &f.recipient, &10).is_err());
    assert_eq!(f.events().len(), before);
    assert_eq!(f.client().get_stream(&f.id), stream);
    f.assert_accounting(0, 10);
}
