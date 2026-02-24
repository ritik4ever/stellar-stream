#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

fn create_token(env: &Env, admin: &Address) -> Address {
    let token_contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    token_contract_id.address()
}

#[test]
fn test_get_next_stream_id() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    assert_eq!(client.get_next_stream_id(), 0);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &5000);
    client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000);
    assert_eq!(client.get_next_stream_id(), 1);
    client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000);
    assert_eq!(client.get_next_stream_id(), 2);
}

#[test]
fn test_claim_transfers_tokens_to_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 500);
    let claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(claimed, 500);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 500);
}

#[test]
fn test_claim_partial_then_full() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &300);
    env.ledger().with_mut(|l| l.timestamp = 1000);
    client.claim(&stream_id, &recipient, &700);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 1000);
}

#[test]
#[should_panic(expected = "amount exceeds claimable")]
fn test_claim_cannot_exceed_vested_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 250);
    client.claim(&stream_id, &recipient, &500);
}

#[test]
#[should_panic(expected = "amount exceeds claimable")]
fn test_claim_cannot_double_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &500);
    client.claim(&stream_id, &recipient, &500);
}

#[test]
#[should_panic(expected = "recipient mismatch")]
fn test_claim_fails_with_wrong_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let wrong_recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &wrong_recipient, &500);
}

#[test]
#[should_panic(expected = "insufficient sender balance")]
fn test_create_stream_fails_with_insufficient_sender_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &100);
    client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
}

#[test]
fn test_claimable_before_stream_start_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000);
    assert_eq!(client.claimable(&stream_id, &999), 0);
    assert_eq!(client.claimable(&stream_id, &1000), 0);
}

#[test]
fn test_claimable_during_stream_is_linear() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    assert_eq!(client.claimable(&stream_id, &250), 250);
    assert_eq!(client.claimable(&stream_id, &500), 500);
    assert_eq!(client.claimable(&stream_id, &750), 750);
}

#[test]
fn test_claimable_accounts_for_already_claimed() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &300);
    // 500 vested - 300 claimed = 200 remaining
    assert_eq!(client.claimable(&stream_id, &500), 200);
}

// ── Claimable: after stream ends ─────────────────────────────────────────────

#[test]
fn test_claimable_after_stream_end_caps_at_total() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    // query well past end_time
    assert_eq!(client.claimable(&stream_id, &1000), 1000);
    assert_eq!(client.claimable(&stream_id, &9999), 1000);
}

// ── Cancel behavior ───────────────────────────────────────────────────────────

#[test]
fn test_cancel_refunds_unclaimed_to_sender() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 500);
    // cancel at t=500: 500 vested (for recipient), 500 unvested (refund to sender)
    client.cancel(&stream_id, &sender);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 500); // unvested refund
}

#[test]
fn test_cancel_marks_stream_as_canceled() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    client.cancel(&stream_id, &sender);
    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
}

#[test]
fn test_cancel_idempotent_double_cancel_does_not_panic() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    client.cancel(&stream_id, &sender);
    // second cancel should be a no-op, not a panic
    client.cancel(&stream_id, &sender);
}

#[test]
fn test_cancel_recipient_cannot_claim_beyond_vested_at_cancel_time() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    // stream t=0..1000, cancel at t=500 (500 tokens vested)
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.cancel(&stream_id, &sender);
    // recipient can still claim the 500 that were vested at cancel time
    client.claim(&stream_id, &recipient, &500);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 500);
}

#[test]
#[should_panic(expected = "sender mismatch")]
fn test_cancel_fails_with_wrong_sender() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let wrong_sender = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    client.cancel(&stream_id, &wrong_sender);
}

// ── Invalid claim attempts ────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_claim_zero_amount_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &0);
}

#[test]
#[should_panic(expected = "amount exceeds claimable")]
fn test_claim_before_stream_start_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    // stream starts at t=1000, ledger is at t=0
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000);
    client.claim(&stream_id, &recipient, &1);
}

#[test]
#[should_panic(expected = "stream not found")]
fn test_claim_nonexistent_stream_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let recipient = Address::generate(&env);
    client.claim(&999, &recipient, &100);
}

// ── create_stream validation ──────────────────────────────────────────────────

#[test]
#[should_panic(expected = "total_amount must be positive")]
fn test_create_stream_zero_amount_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.create_stream(&sender, &recipient, &token, &0, &0, &1000);
}

#[test]
#[should_panic(expected = "end_time must be greater than start_time")]
fn test_create_stream_invalid_time_range_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    client.create_stream(&sender, &recipient, &token, &1000, &1000, &1000);
}
