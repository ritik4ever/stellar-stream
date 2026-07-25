#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Env, IntoVal, Map, String, Symbol, Vec, symbol_short,
};
use insta::assert_debug_snapshot as assert_snapshot;

fn create_token(env: &Env, admin: &Address) -> Address {
    let token_contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    token_contract_id.address()
}

#[contract]
struct MockToken;
#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
    pub fn balance(_env: Env, _id: Address) -> i128 { 1000 }
    pub fn symbol(env: Env) -> String { String::from_str(&env, "XLM") }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Returns a simple one-entry metadata map for use in tests.
fn make_metadata(env: &Env) -> Map<String, String> {
    let mut m = Map::new(env);
    m.set(
        String::from_str(env, "department"),
        String::from_str(env, "engineering"),
    );
    m
}

// ---------------------------------------------------------------------------
// Existing stream-lifecycle tests (metadata = None)
// ---------------------------------------------------------------------------

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
    client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
    assert_eq!(client.get_next_stream_id(), 1);
    client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &wrong_recipient, &500);
}

#[test]
fn test_claim_after_stream_fully_completed() {
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
    
    // Create stream from time 0 to 1000
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    
    // Move time past the end of the stream
    env.ledger().with_mut(|l| l.timestamp = 1500);
    
    // Recipient should be able to claim the full total_amount
    let claimed = client.claim(&stream_id, &recipient, &1000);
    assert_eq!(claimed, 1000);
    
    // Verify the stream state
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 1000);
    assert_eq!(stream.total_amount, 1000);
    
    // Verify claimable is now zero
    let claimable = client.claimable(&stream_id, &1500);
    assert_eq!(claimable, 0);
}

#[test]
#[should_panic(expected = "amount exceeds claimable")]
fn test_claim_on_canceled_stream() {
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
    
    // Create stream from time 0 to 1000
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    
    // Move to midpoint (500 vested)
    env.ledger().with_mut(|l| l.timestamp = 500);
    
    // Cancel the stream at midpoint
    client.cancel(&stream_id, &sender);
    
    // Verify stream is canceled and end_time is adjusted
    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    assert_eq!(stream.end_time, 500);
    assert_eq!(stream.total_amount, 500); // Only 500 vested at cancel time
    
    // Recipient can claim the vested amount (500)
    let claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(claimed, 500);
    
    // Move time forward
    env.ledger().with_mut(|l| l.timestamp = 800);
    
    // Attempting to claim more should panic because nothing more is claimable
    // (stream was canceled at 500, so only 500 total was vested)
    client.claim(&stream_id, &recipient, &100);
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
    client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &300);
    assert_eq!(client.claimable(&stream_id, &500), 200);
}

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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    assert_eq!(client.claimable(&stream_id, &1000), 1000);
    assert_eq!(client.claimable(&stream_id, &9999), 1000);
}

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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.cancel(&stream_id, &sender);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 500);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    client.cancel(&stream_id, &sender);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.cancel(&stream_id, &sender);
    client.claim(&stream_id, &recipient, &500);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 500);
}

#[test]
fn test_cancel_after_partial_claim_refunds_correct_amount_and_preserves_token_conservation() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &300);
    env.ledger().with_mut(|l| l.timestamp = 700);
    client.cancel(&stream_id, &sender);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 300);
    assert_eq!(token_client.balance(&recipient), 300);
    assert_eq!(client.claimable(&stream_id, &9999), 400);

    let stream = client.get_stream(&stream_id);
    assert_snapshot!("stream_cancel_after_partial_claim", stream);
    assert_eq!(300 + 300 + 400, 1000);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    client.cancel(&stream_id, &wrong_sender);
}

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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
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
    client.create_stream(&sender, &recipient, &token, &0, &0, &1000, &0, &None);
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
    client.create_stream(&sender, &recipient, &token, &1000, &1000, &1000, &0, &None);
}

#[test]
fn test_event_emissions() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    let last_event = env.events().all().last().unwrap();

    assert_eq!(last_event.0, contract_id);
    assert_eq!(
        last_event.1,
        (symbol_short!("Stream"), symbol_short!("Created")).into_val(&env)
    );

    let event_data: StreamCreated = last_event.2.into_val(&env);
    let expected_symbol = token::Client::new(&env, &token).symbol();
    assert_eq!(
        event_data,
        StreamCreated {
            stream_id: 1,
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            token_symbol: expected_symbol,
            total_amount: 1000,
            start_time: 0,
            end_time: 1000,
            cliff_seconds: 0,
            metadata: None,
        }
    );

    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &500);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(
        last_event.1,
        (symbol_short!("Stream"), symbol_short!("Claimed")).into_val(&env)
    );

    let event_data: StreamClaimed = last_event.2.into_val(&env);
    assert_eq!(
        event_data,
        StreamClaimed {
            stream_id,
            recipient: recipient.clone(),
            amount: 500,
        }
    );

    client.cancel(&stream_id, &sender);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(
        last_event.1,
        (symbol_short!("Stream"), symbol_short!("Canceled")).into_val(&env)
    );

    let event_data: StreamCanceled = last_event.2.into_val(&env);
    assert_eq!(
        event_data,
        StreamCanceled {
            stream_id,
            sender: sender.clone(),
        }
    );
}

#[test]
fn test_stream_created_snapshot() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let event = StreamCreated {
        stream_id: 1,
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        token_symbol: soroban_sdk::String::from_str(&env, "TEST"),
        total_amount: 1000,
        start_time: 100,
        end_time: 200,
        cliff_seconds: 0,
        metadata: None,
    };

    assert_snapshot!("stream_created_event", event);
}

#[test]
fn test_native_xlm_streaming() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    // Define the sentinel address
    let sentinel = Address::from_string(&String::from_str(&env, NATIVE_SENTINEL));
    
    // Register a mock token contract at its own address
    let native_token_admin = env.register_stellar_asset_contract_v2(sender.clone());
    let native_token_address = native_token_admin.address();
    let native_token_client = token::StellarAssetClient::new(&env, &native_token_address);
    native_token_client.mint(&sender, &1000);
    
    client.initialize(&admin, &native_token_address, &soroban_sdk::vec![&env]);

    let stream_id = client.create_stream(&sender, &recipient, &sentinel, &500, &0, &1000, &0, &None);
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.token, sentinel);
    
    // Claiming
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &250);
    
    let stream_after = client.get_stream(&stream_id);
    assert_eq!(stream_after.claimed_amount, 250);
}

#[test]
fn test_create_split_stream_creates_child_streams_and_links() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);

    let mut recipients = Vec::new(&env);
    recipients.push_back((recipient_a.clone(), 400));
    recipients.push_back((recipient_b.clone(), 600));

    let parent_id = client.create_split_stream(&sender, &token, &1000, &0, &1000, &recipients);
    let children = client.get_split_children(&parent_id);

    assert_eq!(children.len(), 2);
    let child_a_id = children.get(0).unwrap();
    let child_b_id = children.get(1).unwrap();

    let child_a = client.get_stream(&child_a_id);
    let child_b = client.get_stream(&child_b_id);
    assert_eq!(child_a.recipient, recipient_a);
    assert_eq!(child_a.total_amount, 400);
    assert_eq!(child_b.recipient, recipient_b);
    assert_eq!(child_b.total_amount, 600);
}

#[test]
fn test_split_stream_claim_and_cancel_work_per_substream() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let token_client = token::Client::new(&env, &token);

    let mut recipients = Vec::new(&env);
    recipients.push_back((recipient_a.clone(), 400));
    recipients.push_back((recipient_b.clone(), 600));

    let parent_id = client.create_split_stream(&sender, &token, &1000, &0, &1000, &recipients);
    let children = client.get_split_children(&parent_id);
    let child_a_id = children.get(0).unwrap();
    let child_b_id = children.get(1).unwrap();

    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&child_a_id, &recipient_a, &200);
    client.cancel(&child_b_id, &sender);

    assert_eq!(token_client.balance(&recipient_a), 200);
    assert_eq!(token_client.balance(&sender), 300);
    assert_eq!(client.claimable(&child_b_id, &1000), 300);
}

#[test]
fn test_pause_resume_freezes_vesting_and_extends_end_time() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 300);
    client.pause_stream(&stream_id, &sender);
    assert_eq!(client.claimable(&stream_id, &450), 300);

    env.ledger().with_mut(|l| l.timestamp = 500);
    client.resume_stream(&stream_id, &sender);

    assert_eq!(client.claimable(&stream_id, &700), 500);
    assert_eq!(client.claimable(&stream_id, &1200), 1000);
}

#[test]
fn test_vested_amount_fuzz_invariants() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let stream = Stream {
        sender,
        recipient,
        token,
        total_amount: 1_000_000,
        claimed_amount: 0,
        start_time: 100,
        end_time: 10_100,
        cliff_seconds: 0,
        canceled: false,
        paused: false,
        pause_started_at: None,
        metadata: None,
    };

    let mut seed: u64 = 0xDEADBEEFCAFEBABE;
    for _ in 0..2048 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let at_time = seed % 20_000;
        let vested = vested_amount(&stream, at_time);
        assert!(vested <= stream.total_amount);
        assert!(vested >= 0);
        if at_time <= stream.start_time {
            assert_eq!(vested, 0);
        }
        if at_time >= stream.end_time {
            assert_eq!(vested, stream.total_amount);
        }
    }
}

#[test]
#[should_panic(expected = "ContractError::TokenNotAllowed")]
fn test_create_stream_fails_with_invalid_token_address() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    // Register a valid token for native to pass init
    let valid_token_admin = env.register_stellar_asset_contract_v2(sender.clone());
    let valid_token = valid_token_admin.address();
    
    // Initialize with only valid_token allowed
    client.initialize(&admin, &valid_token, &soroban_sdk::vec![&env, valid_token.clone()]);

    // Use a random address that does not host a token contract
    let invalid_token = Address::generate(&env);

    client.create_stream(
        &sender,
        &recipient,
        &invalid_token,
        &1000,
        &0,
        &1000,
        &0,
        &None,
    );
}

#[test]
fn test_claimable_at_start_time() {
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
    assert_eq!(client.claimable(&stream_id, &1000), 0);
}

#[test]
fn test_claimable_at_end_time() {
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
    assert_eq!(client.claimable(&stream_id, &2000), 1000);
}

#[test]
fn test_claimable_after_end_time() {
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
    assert_eq!(client.claimable(&stream_id, &2100), 1000);
}

// -----------------------------------------------------------------
// CANCEL BEFORE STREAM START
// -----------------------------------------------------------------

#[test]
fn test_cancel_before_start_refunds_full_amount_to_sender() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &500, &1500, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 0);
    client.cancel(&stream_id, &sender);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 1000);
    assert_eq!(token_client.balance(&recipient), 0);
}

#[test]
fn test_cancel_before_start_recipient_claimable_is_zero() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &500, &1500, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 0);
    client.cancel(&stream_id, &sender);

    assert_eq!(client.claimable(&stream_id, &1500), 0);
    assert_eq!(client.claimable(&stream_id, &9999), 0);
}

#[test]
#[should_panic(expected = "amount exceeds claimable")]
fn test_cancel_before_start_claim_attempt_panics() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &500, &1500, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 0);
    client.cancel(&stream_id, &sender);

    env.ledger().with_mut(|l| l.timestamp = 2000);
    client.claim(&stream_id, &recipient, &1);
}

// -----------------------------------------------------------------
// CANCEL MID-STREAM / CLIFF VESTING
// -----------------------------------------------------------------

#[test]
fn test_cliff_vesting_blocks_claim_before_cliff() {
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

    // Create stream with cliff of 250 seconds
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &250, &None);

    // Before cliff, claimable is 0
    assert_eq!(client.claimable(&stream_id, &249), 0);

    // Exactly at cliff, claimable resumes linear vesting (25% of 1000 = 250)
    assert_eq!(client.claimable(&stream_id, &250), 250);

    // After cliff, linear vesting continues normally
    assert_eq!(client.claimable(&stream_id, &500), 500);
}

#[test]
fn test_transfer_stream_updates_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let new_recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

    client.transfer_stream(&stream_id, &new_recipient);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.recipient, new_recipient);

    // Verify events
    let last_event = env.events().all().last().unwrap();
    assert_eq!(
        last_event.1,
        (symbol_short!("Stream"), symbol_short!("Transfer")).into_val(&env)
    );
    let event_data: StreamTransferred = last_event.2.into_val(&env);
    assert_eq!(event_data.old_recipient, recipient);
    assert_eq!(event_data.new_recipient, new_recipient);
}

#[test]
fn test_transfer_stream_claim_by_new_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let new_recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 250);
    // 250 vested, recipient claims 100
    client.claim(&stream_id, &recipient, &100);

    client.transfer_stream(&stream_id, &new_recipient);

    env.ledger().with_mut(|l| l.timestamp = 500);
    // 500 vested total, 100 claimed, 400 claimable by new_recipient
    assert_eq!(client.claimable(&stream_id, &500), 400);

    client.claim(&stream_id, &new_recipient, &400);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&new_recipient), 400);
}

#[test]
#[should_panic(expected = "amount exceeds claimable")]
fn test_claim_rapid_succession_prevents_double_pay() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

    // Advance ledger to 100% vested
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Call claim for full vested amount — succeeds
    let claimed = client.claim(&stream_id, &recipient, &1000);
    assert_eq!(claimed, 1000);

    // Total paid never exceeds total_amount (verified by checking balance)
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 1000);

    // Second claim for same amount panics — enforced by should_panic above
    client.claim(&stream_id, &recipient, &1000);
}

/// Multiple key-value pairs survive the round-trip through storage.
#[test]
fn test_metadata_multiple_labels_round_trip() {
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

    let mut meta = Map::new(&env);
    meta.set(String::from_str(&env, "department"), String::from_str(&env, "engineering"));
    meta.set(String::from_str(&env, "project"), String::from_str(&env, "xlm-vesting"));
    meta.set(String::from_str(&env, "cost_center"), String::from_str(&env, "cc-42"));

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &Some(meta.clone()));


    let stream = client.get_stream(&stream_id);
    let stored = stream.metadata.unwrap();
    assert_eq!(
        stored.get(String::from_str(&env, "department")),
        Some(String::from_str(&env, "engineering"))
    );
    assert_eq!(
        stored.get(String::from_str(&env, "project")),
        Some(String::from_str(&env, "xlm-vesting"))
    );
    assert_eq!(
        stored.get(String::from_str(&env, "cost_center")),
        Some(String::from_str(&env, "cc-42"))
    );
}

// =============================================================================
// #119 — CLAWBACK TESTS
// =============================================================================

/// initialize stores the admin address.
#[test]
fn test_initialize_stores_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let compliance_admin = Address::generate(&env);
    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    // No panic → admin was stored successfully
}

/// Double-initialization panics with "already initialized".
#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_cannot_be_called_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let compliance_admin = Address::generate(&env);
    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
}

/// Admin can claw back up to the unclaimed vested amount.
#[test]
fn test_clawback_transfers_to_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0,
        &None,
    );

    // At t=500, vested = 500, claimed = 0 → max clawback = 500
    env.ledger().with_mut(|l| l.timestamp = 500);
    let clawed = client.clawback(&stream_id, &300, &compliance_admin);

    assert_eq!(clawed, 300);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&compliance_admin), 300);
}

/// Clawback caps at unclaimed vested even when amount requested is larger.
#[test]
fn test_clawback_caps_at_unclaimed_vested() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0,
        &None,
    );

    // At t=400, vested = 400 → requesting 1000 should be capped to 400
    env.ledger().with_mut(|l| l.timestamp = 400);
    let clawed = client.clawback(&stream_id, &1000, &compliance_admin);
    assert_eq!(clawed, 400);
}

/// After a clawback, recipient can only claim the remaining vested amount.
#[test]
fn test_clawback_reduces_recipient_claimable() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0,
        &None,
    );

    // At t=500, vested = 500; admin claws back 200
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.clawback(&stream_id, &200, &compliance_admin);

    // Recipient should now only be able to claim 500 - 200 = 300
    assert_eq!(client.claimable(&stream_id, &500), 300);
    client.claim(&stream_id, &recipient, &300);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 300);
    assert_eq!(token_client.balance(&compliance_admin), 200);
}

/// Non-admin callers panic with "unauthorized".
#[test]
#[should_panic(expected = "unauthorized")]
fn test_clawback_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0,
        &None,
    );

    env.ledger().with_mut(|l| l.timestamp = 500);
    // attacker != compliance_admin → should panic
    client.clawback(&stream_id, &100, &attacker);
}

/// Calling clawback before initialize panics with "contract not initialized".
#[test]
#[should_panic(expected = "contract not initialized")]
fn test_clawback_before_initialize_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let someone = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0, &None,
    );
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.clawback(&stream_id, &100, &someone);
}

/// ClawbackExecuted event is emitted with correct fields.
#[test]
fn test_clawback_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0,
        &None,
    );

    env.ledger().with_mut(|l| l.timestamp = 500);
    client.clawback(&stream_id, &250, &compliance_admin);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(
        last_event.1,
        (symbol_short!("Stream"), symbol_short!("Clawback")).into_val(&env)
    );
    let event_data: ClawbackExecuted = last_event.2.into_val(&env);
    assert_eq!(event_data.stream_id, stream_id);
    assert_eq!(event_data.amount, 250);
    assert_eq!(event_data.recipient, compliance_admin);
    assert_snapshot!("clawback_executed_event", event_data);
}

#[test]
fn test_clawback_after_canceled_stream_transfers_to_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0, &None,
    );

    env.ledger().with_mut(|l| l.timestamp = 400);
    client.cancel(&stream_id, &sender);

    env.ledger().with_mut(|l| l.timestamp = 500);
    let clawed = client.clawback(&stream_id, &200, &compliance_admin);

    assert_eq!(clawed, 200);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&compliance_admin), 200);
    assert_eq!(client.claimable(&stream_id, &500), 200);
}

/// Token conservation: recipient claims + admin clawback = total vested at clawback time.
#[test]
#[should_panic(expected = "amount exceeds claimable")]
fn test_clawback_token_conservation() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin_addr = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin_addr);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    client.initialize(&compliance_admin, &Address::generate(&env), &soroban_sdk::vec![&env]);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0,
        &None,
    );

    // Recipient claims 200 at t=400
    env.ledger().with_mut(|l| l.timestamp = 400);
    client.claim(&stream_id, &recipient, &200);

    // Admin claws back 100 at t=600 (vested=600, claimed=200, unclaimed=400)
    env.ledger().with_mut(|l| l.timestamp = 600);
    client.clawback(&stream_id, &100, &compliance_admin);

    // Remaining claimable for recipient = 600 - 200 - 100 = 300
    assert_eq!(client.claimable(&stream_id, &600), 300);
    client.claim(&stream_id, &recipient, &300);

    let token_client = token::Client::new(&env, &token);
    // recipient: 200 + 300 = 500, admin: 100, escrow holds 400 (unvested)
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&compliance_admin), 100);
    // Attempt second claim for same amount — panics with 'amount exceeds claimable'
    client.claim(&stream_id, &recipient, &1000);
}

#[test]
#[should_panic(expected = "pause timestamp missing")]
fn test_resume_stream_panic_on_missing_timestamp() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let stream_id = 1u64;
    // Directly write an inconsistent Stream struct to storage:
    // paused = true but pause_started_at = None.
    // This state should be impossible under normal operation but is tested defensively.
    let stream = Stream {
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        total_amount: 1000,
        claimed_amount: 0,
        start_time: 1000,
        end_time: 2000,
        cliff_seconds: 0,
        canceled: false,
        paused: true,
        pause_started_at: None,
        metadata: None,
    };

    env.as_contract(&contract_id, || env.storage()
        .persistent()
        .set(&DataKey::Stream(stream_id), &stream));

    client.resume_stream(&stream_id, &sender);
}

#[test]
fn test_pause_resume_normal_flow() {
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

    // Create stream: start at 1000, end at 2000
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

    // Advance to t=1100 and pause
    env.ledger().with_mut(|l| l.timestamp = 1100);
    client.pause_stream(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert!(stream.paused);
    assert_eq!(stream.pause_started_at, Some(1100));

    // Advance to t=1200 and resume
    env.ledger().with_mut(|l| l.timestamp = 1200);
    client.resume_stream(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert!(!stream.paused);
    assert_eq!(stream.pause_started_at, None);
    
    // Paused for 100s (from 1100 to 1200), so start/end should shift by 100
    assert_eq!(stream.start_time, 1100);
    assert_eq!(stream.end_time, 2100);
}

#[test]
fn test_claimable_while_paused_clamped() {
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

    // Create stream: start at 1000, end at 2000 (total 1000 units)
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

    // Advance to t=1500 (50% vested) and pause
    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.pause_stream(&stream_id, &sender);

    // Advance to t=1600 while paused
    // Claimable should still be 500 (clamped to t=1500)
    assert_eq!(client.claimable(&stream_id, &1600), 500);
}

#[test]
fn test_vested_constant_while_paused() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.pause_stream(&stream_id, &sender);

    // Check at different times while paused
    assert_eq!(client.claimable(&stream_id, &1501), 500);
    assert_eq!(client.claimable(&stream_id, &1700), 500);
    assert_eq!(client.claimable(&stream_id, &1999), 500);
}

#[test]
fn test_vesting_resumes_after_resume() {
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

    // 1000-2000 duration
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

    // Pause at 1500 (50% vested)
    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.pause_stream(&stream_id, &sender);

    // Resume at 1600 (paused for 100s)
    env.ledger().with_mut(|l| l.timestamp = 1600);
    client.resume_stream(&stream_id, &sender);

    // New start_time = 1100, new end_time = 2100
    // At t=1600, vested should be (1600-1100)/(2100-1100) * 1000 = 500/1000 * 1000 = 500
    assert_eq!(client.claimable(&stream_id, &1600), 500);

    // Advance to t=1850
    // Vested should be (1850-1100)/1000 * 1000 = 750
    assert_eq!(client.claimable(&stream_id, &1850), 750);
}

#[test]
fn test_pause_at_start_time_vested_is_zero() {
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

    // Start at 1000
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

    // Pause exactly at start_time
    env.ledger().with_mut(|l| l.timestamp = 1000);
    client.pause_stream(&stream_id, &sender);

    // Advance while paused
    assert_eq!(client.claimable(&stream_id, &1100), 0);
    assert_eq!(client.claimable(&stream_id, &1500), 0);
}

#[test]
fn test_pause_resume_snapshot_lifecycle() {
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

    // 1. Create stream: start at 1000, end at 2000
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

    // 2. Pause midway at t=1500
    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.pause_stream(&stream_id, &sender);

    let paused_stream = client.get_stream(&stream_id);
    assert!(paused_stream.paused);
    assert_eq!(paused_stream.pause_started_at, Some(1500));
    assert_snapshot!(paused_stream);

    // 3. Resume at t=1600 (paused duration = 100)
    env.ledger().with_mut(|l| l.timestamp = 1600);
    client.resume_stream(&stream_id, &sender);

    let resumed_stream = client.get_stream(&stream_id);
    assert!(!resumed_stream.paused);
    assert_eq!(resumed_stream.pause_started_at, None);
    // Original duration was 1000 (1000 to 2000). Shifted by 100 -> 1100 to 2100.
    assert_eq!(resumed_stream.start_time, 1100);
    assert_eq!(resumed_stream.end_time, 2100);
    assert_snapshot!(resumed_stream);

    // 4. Claim after resume at t=1850
    // Vested: (1850 - 1100) / (2100 - 1100) * 1000 = 750 / 1000 * 1000 = 750
    env.ledger().with_mut(|l| l.timestamp = 1850);
    let claimed = client.claim(&stream_id, &recipient, &750);
    assert_eq!(claimed, 750);
    
    let post_claim_stream = client.get_stream(&stream_id);
    assert_eq!(post_claim_stream.claimed_amount, 750);
    assert_snapshot!(post_claim_stream);
}

#[test]
#[should_panic(expected = "stream already paused")]
fn test_pause_already_paused_stream_panics() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
    
    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.pause_stream(&stream_id, &sender);
    
    // Attempt to pause again
    client.pause_stream(&stream_id, &sender);
}

#[test]
fn test_create_split_stream_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);

    let mut recipients = Vec::new(&env);
    recipients.push_back((r1.clone(), 400_i128));
    recipients.push_back((r2.clone(), 600_i128));

    // 400 + 600 = 1000 (matches total_amount)
    let parent_id = client.create_split_stream(&sender, &token, &1000, &1000, &2000, &recipients);
    
    // Verify SplitChildren storage
    let children = client.get_split_children(&parent_id);
    assert_eq!(children.len(), 2);
    
    let c1_id = children.get(0).unwrap();
    let c2_id = children.get(1).unwrap();
    
    let c1 = client.get_stream(&c1_id);
    let c2 = client.get_stream(&c2_id);
    
    assert_eq!(c1.recipient, r1);
    assert_eq!(c1.total_amount, 400);
    assert_eq!(c2.recipient, r2);
    assert_eq!(c2.total_amount, 600);

    assert_snapshot!(children);
}

#[test]
#[should_panic(expected = "allocations must equal total_amount")]
fn test_create_split_stream_undersum_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);

    let mut recipients = Vec::new(&env);
    recipients.push_back((Address::generate(&env), 400_i128));
    recipients.push_back((Address::generate(&env), 500_i128));

    // 400 + 500 = 900 != 1000
    client.create_split_stream(&sender, &token, &1000, &1000, &2000, &recipients);
}

#[test]
#[should_panic(expected = "allocations must equal total_amount")]
fn test_create_split_stream_oversum_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1100);

    let mut recipients = Vec::new(&env);
    recipients.push_back((Address::generate(&env), 600_i128));
    recipients.push_back((Address::generate(&env), 500_i128));

    // 600 + 500 = 1100 != 1000
    client.create_split_stream(&sender, &token, &1000, &1000, &2000, &recipients);
}

#[test]
#[should_panic(expected = "recipients must not be empty")]
fn test_create_split_stream_empty_recipients_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);

    let recipients = Vec::<(Address, i128)>::new(&env);

    client.create_split_stream(&sender, &token, &1000, &1000, &2000, &recipients);
}

// =============================================================================
// #214 — StreamCreated event snapshot tests with metadata
// =============================================================================

/// Snapshot of StreamCreated event when metadata = None (named baseline).
#[test]
fn test_stream_created_no_metadata_snapshot() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let event = StreamCreated {
        stream_id: 1,
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        token_symbol: soroban_sdk::String::from_str(&env, "TEST"),
        total_amount: 1000,
        start_time: 100,
        end_time: 200,
        cliff_seconds: 0,
        metadata: None,
    };

    assert_snapshot!("stream_created_no_metadata", event);
}

/// Snapshot of StreamCreated event when metadata is populated.
/// Verifies metadata key/value pairs survive round-trip through Soroban event emission.
#[test]
fn test_stream_created_with_metadata_snapshot() {
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

    let meta = make_metadata(&env);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0,
        &Some(meta.clone()),
    );

    // Capture the emitted StreamCreated event
    let last_event = env.events().all().last().unwrap();
    assert_eq!(
        last_event.1,
        (symbol_short!("Stream"), symbol_short!("Created")).into_val(&env)
    );
    let event_data: StreamCreated = last_event.2.into_val(&env);

    // Verify metadata key/value pairs survive round-trip
    let stored_meta = event_data.metadata.clone().unwrap();
    assert_eq!(
        stored_meta.get(soroban_sdk::String::from_str(&env, "department")),
        Some(soroban_sdk::String::from_str(&env, "engineering"))
    );

    // Also verify the stream itself stored the metadata
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.metadata, Some(meta));

    assert_snapshot!("stream_created_with_metadata", event_data);
}

/// Large metadata map (10 entries) does not cause storage budget issues.
#[test]
fn test_stream_created_large_metadata_no_budget_panic() {
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

    let mut large_meta = Map::new(&env);
    for i in 0u32..10 {
        let key = soroban_sdk::String::from_str(&env, "key");
        let val = soroban_sdk::String::from_str(&env, "val");
        large_meta.set(key, val);
        let _ = i; // suppress unused warning
    }
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k0"), soroban_sdk::String::from_str(&env, "v0"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k1"), soroban_sdk::String::from_str(&env, "v1"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k2"), soroban_sdk::String::from_str(&env, "v2"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k3"), soroban_sdk::String::from_str(&env, "v3"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k4"), soroban_sdk::String::from_str(&env, "v4"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k5"), soroban_sdk::String::from_str(&env, "v5"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k6"), soroban_sdk::String::from_str(&env, "v6"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k7"), soroban_sdk::String::from_str(&env, "v7"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k8"), soroban_sdk::String::from_str(&env, "v8"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k9"), soroban_sdk::String::from_str(&env, "v9"),
    );

    // Should not panic — no budget issues with 10 entries
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0,
        &Some(large_meta.clone()),
    );

    let stream = client.get_stream(&stream_id);
    assert!(stream.metadata.is_some());
    assert_eq!(
        stream.metadata.unwrap().get(soroban_sdk::String::from_str(&env, "k9")),
        Some(soroban_sdk::String::from_str(&env, "v9"))
    );
}

// =============================================================================
// #213 — initialize guard: prevent double initialization
// =============================================================================

/// First initialize stores admin correctly.
#[test]
fn test_initialize_guard_stores_admin_on_first_call() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);

    // First call must not panic
    client.initialize(&admin, &native_token, &soroban_sdk::vec![&env]);

    // Admin is stored — verify by confirming clawback uses it (non-admin panics)
    // We just verify no panic on first init; admin storage is confirmed by clawback tests.
}

/// Double initialization panics with "already initialized".
#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_guard_double_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);

    client.initialize(&admin, &native_token, &soroban_sdk::vec![&env]);
    // Second call must panic
    client.initialize(&admin, &native_token, &soroban_sdk::vec![&env]);
}

/// Double initialization with a different admin also panics — no privilege escalation.
#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_guard_different_admin_cannot_replace() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let native_token = Address::generate(&env);

    client.initialize(&admin, &native_token, &soroban_sdk::vec![&env]);
    // Attacker tries to replace admin — must panic
    client.initialize(&attacker, &native_token, &soroban_sdk::vec![&env]);
}

/// Clawback is rejected before initialize is called (no admin set).
#[test]
#[should_panic(expected = "contract not initialized")]
fn test_initialize_guard_clawback_rejected_before_init() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1000, &0, &1000, &0, &None,
    );
    env.ledger().with_mut(|l| l.timestamp = 500);

    // No initialize called — clawback must panic with "contract not initialized"
    client.clawback(&stream_id, &100, &sender);
}

// =============================================================================
// #218 — Stream ID auto-increment across split stream creation
// =============================================================================

/// After a regular stream, next ID is 1.
/// After a split stream with 3 recipients, next ID is 5 (1 parent + 3 children).
/// After another regular stream, ID is 6 (no collision).
#[test]
fn test_stream_id_auto_increment_across_split_stream() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);
    let r4 = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &10000);

    // Regular stream → ID 1, next = 1
    let regular_id = client.create_stream(
        &sender, &r1, &token, &100, &0, &1000, &0, &None,
    );
    assert_eq!(regular_id, 1);
    assert_eq!(client.get_next_stream_id(), 1);

    // Split stream with 3 recipients → parent = 2, children = 3, 4, 5; next = 5
    let mut recipients = Vec::new(&env);
    recipients.push_back((r2.clone(), 300_i128));
    recipients.push_back((r3.clone(), 300_i128));
    recipients.push_back((r4.clone(), 400_i128));

    let parent_id = client.create_split_stream(
        &sender, &token, &1000, &0, &1000, &recipients,
    );
    assert_eq!(parent_id, 2);
    assert_eq!(client.get_next_stream_id(), 5);

    // Child IDs are contiguous: 3, 4, 5
    let children = client.get_split_children(&parent_id);
    assert_eq!(children.len(), 3);
    assert_eq!(children.get(0).unwrap(), 3);
    assert_eq!(children.get(1).unwrap(), 4);
    assert_eq!(children.get(2).unwrap(), 5);

    // Another regular stream → ID 6, no collision
    let next_regular_id = client.create_stream(
        &sender, &r1, &token, &100, &0, &1000, &0, &None,
    );
    assert_eq!(next_regular_id, 6);
    assert_eq!(client.get_next_stream_id(), 6);
}

/// Child stream IDs are contiguous and match SplitChildren mapping.
#[test]
fn test_split_stream_child_ids_are_contiguous_and_match_mapping() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &5000);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);

    let mut recipients = Vec::new(&env);
    recipients.push_back((r1.clone(), 500_i128));
    recipients.push_back((r2.clone(), 500_i128));

    let parent_id = client.create_split_stream(
        &sender, &token, &1000, &0, &1000, &recipients,
    );

    let children = client.get_split_children(&parent_id);
    assert_eq!(children.len(), 2);

    // Children must be contiguous starting at parent_id + 1
    let c0 = children.get(0).unwrap();
    let c1 = children.get(1).unwrap();
    assert_eq!(c0, parent_id + 1);
    assert_eq!(c1, parent_id + 2);

    // Verify each child stream is retrievable and has correct recipient
    let stream_c0 = client.get_stream(&c0);
    let stream_c1 = client.get_stream(&c1);
    assert_eq!(stream_c0.recipient, r1);
    assert_eq!(stream_c1.recipient, r2);
}

/// No ID collisions across multiple mixed stream creations.
#[test]
fn test_no_id_collisions_across_mixed_stream_creations() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &50000);

    let mut seen_ids: std::vec::Vec<u64> = std::vec::Vec::new();

    // Regular stream → ID 1
    let id1 = client.create_stream(
        &sender, &Address::generate(&env), &token, &100, &0, &1000, &0, &None,
    );
    seen_ids.push(id1);

    // Split with 2 recipients → parent = 2, children = 3, 4
    let mut r2 = Vec::new(&env);
    r2.push_back((Address::generate(&env), 50_i128));
    r2.push_back((Address::generate(&env), 50_i128));
    let parent2 = client.create_split_stream(&sender, &token, &100, &0, &1000, &r2);
    seen_ids.push(parent2);
    for child in client.get_split_children(&parent2).iter() {
        seen_ids.push(child);
    }

    // Regular stream → ID 5
    let id5 = client.create_stream(
        &sender, &Address::generate(&env), &token, &100, &0, &1000, &0, &None,
    );
    seen_ids.push(id5);

    // Split with 1 recipient → parent = 6, child = 7
    let mut r3 = Vec::new(&env);
    r3.push_back((Address::generate(&env), 100_i128));
    let parent6 = client.create_split_stream(&sender, &token, &100, &0, &1000, &r3);
    seen_ids.push(parent6);
    for child in client.get_split_children(&parent6).iter() {
        seen_ids.push(child);
    }

    // All IDs must be unique
    let unique_count = {
        let mut sorted = seen_ids.clone();
        sorted.sort();
        sorted.dedup();
        sorted.len()
    };
    assert_eq!(unique_count, seen_ids.len(), "ID collision detected: {:?}", seen_ids);

    // next_stream_id must equal the highest ID seen
    let max_id = seen_ids.iter().copied().max().unwrap();
    assert_eq!(client.get_next_stream_id(), max_id);
}

#[test]
fn test_get_claimable_batch_empty() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let stream_ids = Vec::new(&env);
    let result = client.get_claimable_batch(&stream_ids, &1000);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_get_claimable_batch_single_and_multi() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &2000);

    let id1 = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    let id2 = client.create_stream(&sender, &recipient, &token, &1000, &500, &1500, &0, &None);

    let mut ids = Vec::new(&env);
    ids.push_back(id1);
    ids.push_back(id2);
    ids.push_back(999); // Unknown ID

    let result = client.get_claimable_batch(&ids, &500);
    assert_eq!(result.get(id1).unwrap(), 500);
    assert_eq!(result.get(id2).unwrap(), 0);
    assert_eq!(result.get(999).unwrap(), 0);

    let result_late = client.get_claimable_batch(&ids, &1000);
    assert_eq!(result_late.get(id1).unwrap(), 1000);
    assert_eq!(result_late.get(id2).unwrap(), 500);
    assert_eq!(result_late.get(999).unwrap(), 0);
}

#[test]
#[should_panic(expected = "too many stream ids")]
fn test_get_claimable_batch_limit_exceeded() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let mut ids = Vec::new(&env);
    for i in 0..21 {
        ids.push_back(i as u64);
    }
    client.get_claimable_batch(&ids, &1000);
}


// =============================================================================
// #212 — get_split_children returns empty Vec for non-split streams
// =============================================================================

/// Calling get_split_children on a regular (non-split) stream returns an empty Vec.
#[test]
fn test_get_split_children_on_regular_stream_returns_empty() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    let children = client.get_split_children(&stream_id);
    assert_eq!(children.len(), 0);
}

/// Calling get_split_children on a stream ID that does not exist returns an empty Vec (no panic).
#[test]
fn test_get_split_children_on_nonexistent_stream_returns_empty() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let children = client.get_split_children(&9999);
    assert_eq!(children.len(), 0);
}

/// Calling get_split_children on a valid parent stream returns the correct child IDs,
/// and the ChildToParent storage key maps each child back to the parent.
#[test]
fn test_get_split_children_on_parent_stream_returns_child_ids_and_child_to_parent_mapping() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);

    let mut recipients = Vec::new(&env);
    recipients.push_back((recipient_a.clone(), 300_i128));
    recipients.push_back((recipient_b.clone(), 700_i128));

    let parent_id = client.create_split_stream(&sender, &token, &1000, &0, &1000, &recipients);
    let children = client.get_split_children(&parent_id);

    assert_eq!(children.len(), 2);
    let child_a_id = children.get(0).unwrap();
    let child_b_id = children.get(1).unwrap();

    // Verify child streams have correct allocations
    let child_a = client.get_stream(&child_a_id);
    let child_b = client.get_stream(&child_b_id);
    assert_eq!(child_a.total_amount, 300);
    assert_eq!(child_b.total_amount, 700);

    // Verify ChildToParent storage maps each child back to the parent
    let parent_of_a: u64 = env.as_contract(&contract_id, || env
        .storage()
        .persistent()
        .get(&DataKey::ChildToParent(child_a_id))
        .unwrap());
    let parent_of_b: u64 = env.as_contract(&contract_id, || env
        .storage()
        .persistent()
        .get(&DataKey::ChildToParent(child_b_id))
        .unwrap());
    assert_eq!(parent_of_a, parent_id);
    assert_eq!(parent_of_b, parent_id);
}

// =============================================================================
// #334 — Full cancel-after-partial-claim lifecycle integration test
// =============================================================================

#[test]
fn test_cancel_after_partial_claim_full_lifecycle() {
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
    let token_client = token::Client::new(&env, &token);

    // Step 1: Create stream with 100 XLM over 100 seconds
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &100, &0, &100, &0, &None,
    );

    // Verify sender balance is 0 (all escrowed)
    assert_eq!(token_client.balance(&sender), 0);

    // Step 2: Advance time to 50s, recipient claims 50 XLM
    env.ledger().with_mut(|l| l.timestamp = 50);
    assert_eq!(client.claimable(&stream_id, &50), 50);
    let claimed = client.claim(&stream_id, &recipient, &50);
    assert_eq!(claimed, 50);
    assert_eq!(token_client.balance(&recipient), 50);

    // Step 3: Cancel stream at 50s
    client.cancel(&stream_id, &sender);

    // Step 4: Sender receives 50 XLM refund (100 total - 50 vested)
    let sender_refund = token_client.balance(&sender);
    assert_eq!(sender_refund, 50);

    // Step 5: Verify stream state after cancel
    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    assert_eq!(stream.total_amount, 50);
    assert_eq!(stream.claimed_amount, 50);
    assert_eq!(stream.end_time, 50);

    // Step 6: Recipient cannot claim more than already claimed
    assert_eq!(client.claimable(&stream_id, &50), 0);
    assert_eq!(client.claimable(&stream_id, &100), 0);
    assert_eq!(client.claimable(&stream_id, &9999), 0);

    // Step 7: Token conservation: sender_refund + claimed == total original amount
    let recipient_balance = token_client.balance(&recipient);
    assert_eq!(sender_refund + recipient_balance, 100);
}

// ============================================================================
// #589 \u2014 update_start_time tests
// ============================================================================

#[test]
fn test_update_start_time_success() {
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

    // Create a stream scheduled to start in the future.
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &2000, &3000, &0, &None);
    let stream_before = client.get_stream(&stream_id);
    assert_eq!(stream_before.start_time, 2000);

    // Move the ledger forward so new_start_time (2500) is in the future.
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Update the start time to a new future time before end_time (3000).
    client.update_start_time(&stream_id, &sender, &2500);

    let stream_after = client.get_stream(&stream_id);
    assert_eq!(stream_after.start_time, 2500);
}

#[test]
fn test_update_start_time_emits_event() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &2000, &3000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 1000);
    client.update_start_time(&stream_id, &sender, &2500);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(
        last_event.1,
        (symbol_short!("Stream"), symbol_short!("StartUp")).into_val(&env)
    );

    let event_data: StreamStartTimeUpdated = last_event.2.into_val(&env);
    assert_eq!(event_data.stream_id, stream_id);
    assert_eq!(event_data.sender, sender);
    assert_eq!(event_data.old_start_time, 2000);
    assert_eq!(event_data.new_start_time, 2500);
    assert_eq!(event_data.updated_at, 1000);
}

#[test]
#[should_panic(expected = "sender mismatch")]
fn test_update_start_time_fails_with_wrong_sender() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &2000, &3000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 1000);
    client.update_start_time(&stream_id, &wrong_sender, &2500);
}

#[test]
#[should_panic(expected = "new_start_time must be in the future")]
fn test_update_start_time_rejects_past_timestamp() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &2000, &3000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 2500);
    // 2000 is not strictly greater than now (2500)
    client.update_start_time(&stream_id, &sender, &2000);
}

#[test]
#[should_panic(expected = "new_start_time must be before stream end_time")]
fn test_update_start_time_rejects_at_end_time() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &2000, &3000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 1000);
    // Setting new_start_time equal to end_time (3000) must be rejected.
    client.update_start_time(&stream_id, &sender, &3000);
}

#[test]
#[should_panic(expected = "new_start_time must be before stream end_time")]
fn test_update_start_time_rejects_after_end_time() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &2000, &3000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 1000);
    client.update_start_time(&stream_id, &sender, &3500);
}

#[test]
#[should_panic(expected = "stream canceled")]
fn test_update_start_time_rejects_on_canceled_stream() {
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &2000, &3000, &0, &None);
    client.cancel(&stream_id, &sender);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.update_start_time(&stream_id, &sender, &2500);
}
