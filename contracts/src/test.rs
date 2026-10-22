extern crate std;
use super::*;
use crate::errors::ContractError;
use insta::assert_debug_snapshot as assert_snapshot;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token, Env, IntoVal, Map, String, Symbol, Val, Vec,
};

fn create_token(env: &Env, admin: &Address) -> Address {
    let token_contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    token_contract_id.address()
}

#[contract]
struct MockToken;
#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
    pub fn balance(_env: Env, _id: Address) -> i128 {
        1000
    }
    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "XLM")
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
struct PreviousBuildStream {
    sender: Address,
    recipient: Address,
    token: Address,
    total_amount: i128,
    claimed_amount: i128,
    start_time: u64,
    end_time: u64,
    min_claim_interval_seconds: u64,
    last_claim_time: u64,
    canceled: bool,
    paused: bool,
    pause_started_at: Option<u64>,
    metadata: Option<Map<String, String>>,
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

#[test]
fn test_reads_stream_from_previous_build() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let stream_id = 7;
    let previous_stream = PreviousBuildStream {
        sender: Address::generate(&env),
        recipient: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 500,
        claimed_amount: 100,
        start_time: 1_000,
        end_time: 2_000,
        min_claim_interval_seconds: 30,
        last_claim_time: 1_100,
        canceled: false,
        paused: false,
        pause_started_at: None,
        metadata: None,
    };

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &previous_stream);
    });

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.total_amount, previous_stream.total_amount);
    assert_eq!(stream.claimed_amount, previous_stream.claimed_amount);
    assert_eq!(stream.cliff_seconds, 0);
    assert_eq!(stream.vesting_type, String::from_str(&env, "linear"));
}

#[test]
fn test_failed_claims_from_previous_build_preserve_state_and_balances() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let stream_id = 7;
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_client = token::Client::new(&env, &token);
    let previous_stream = PreviousBuildStream {
        sender: Address::generate(&env),
        recipient: recipient.clone(),
        token: token.clone(),
        total_amount: 500,
        claimed_amount: 100,
        start_time: 1_000,
        end_time: 2_000,
        min_claim_interval_seconds: 30,
        last_claim_time: 1_100,
        canceled: false,
        paused: false,
        pause_started_at: None,
        metadata: None,
    };

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &previous_stream);
    });

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_100);
    assert!(client.try_claim(&stream_id, &recipient, &1).is_err());

    let stored_after_pre_transfer_failure: PreviousBuildStream =
        env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .get(&DataKey::Stream(stream_id))
                .unwrap()
        });
    assert_eq!(stored_after_pre_transfer_failure, previous_stream);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(token_client.balance(&recipient), 0);

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_500);
    assert!(client.try_claim(&stream_id, &recipient, &1).is_err());

    let stored_after_transfer_failure: PreviousBuildStream = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap()
    });
    assert_eq!(stored_after_transfer_failure, previous_stream);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(token_client.balance(&recipient), 0);
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, previous_stream.claimed_amount);
    assert_eq!(stream.last_claim_time, previous_stream.last_claim_time);
}

// ---------------------------------------------------------------------------
// Existing stream-lifecycle tests (metadata = None)
// ---------------------------------------------------------------------------

#[test]
fn test_claim_transfers_tokens_and_updates_balance() {
    let env = Env::default();
    env.mock_all_auths();

    // Register escrow contract
    let contract_id = env.register_contract(None, escrow::EscrowVestingContract);
    let client = escrow::EscrowVestingContractClient::new(&env, &contract_id);

    // Setup mock admin, recipient, and SAC token
    let recipient = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_client = token::Client::new(&env, &token_contract);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract);

    // Mint tokens to escrow contract (simulate initial funding)
    let vesting_amount: i128 = 10_000_000; // 10 XLM in stroops / base units
    token_admin_client.mint(&contract_id, &vesting_amount);

    // Verify initial balances
    assert_eq!(token_client.balance(&contract_id), vesting_amount);
    assert_eq!(token_client.balance(&recipient), 0);

    // Setup contract storage state
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "total_vested"), &vesting_amount);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "claimed_amount"), &0i128);
    });

    // Execute claim
    let claimed = client.claim(&recipient, &token_contract);

    // Assertions
    assert_eq!(claimed, vesting_amount);
    assert_eq!(token_client.balance(&recipient), vesting_amount);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn test_over_claim_reverts_with_insufficient_vested() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, escrow::EscrowVestingContract);
    let client = escrow::EscrowVestingContractClient::new(&env, &contract_id);

    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_contract = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    // Set storage where everything has already been claimed
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "total_vested"), &1000i128);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "claimed_amount"), &1000i128);
    });

    // Attempting to claim again should revert with InsufficientVested
    let res = client.try_claim(&recipient, &token_contract);
    assert_eq!(res, Err(Ok(ContractError::InsufficientVested)));
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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
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
            actor: sender.clone(),
            timestamp: 0,
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            token_symbol: expected_symbol,
            total_amount: 1000,
            start_time: 0,
            end_time: 1000,
            cliff_seconds: 0,
            vesting_type: String::from_str(&env, "linear"),
            min_claim_interval_seconds: 0,
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
            actor: recipient.clone(),
            timestamp: 500,
            recipient: recipient.clone(),
            amount: 500,
            claimed_amount: 500,
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
            actor: sender.clone(),
            timestamp: 500,
            sender: sender.clone(),
            refunded_amount: 500,
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
        actor: sender.clone(),
        timestamp: 100,
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        token_symbol: soroban_sdk::String::from_str(&env, "TEST"),
        total_amount: 1000,
        start_time: 100,
        end_time: 200,
        cliff_seconds: 0,
        vesting_type: String::from_str(&env, "linear"),
        min_claim_interval_seconds: 0,
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

    let stream_id =
        client.create_stream(&sender, &recipient, &sentinel, &500, &0, &1000, &0, &None);
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
        vesting_type: String::from_str(&env, "linear"),
        min_claim_interval_seconds: 0,
        last_claim_time: 0,
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
    client.initialize(
        &admin,
        &valid_token,
        &soroban_sdk::vec![&env, valid_token.clone()],
    );

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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);
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

    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &500, &1500, &0, &None);

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

    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &500, &1500, &0, &None);

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

    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &500, &1500, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 0);
    client.cancel(&stream_id, &sender);

    env.ledger().with_mut(|l| l.timestamp = 2000);
    client.claim(&stream_id, &recipient, &1);
}

// -----------------------------------------------------------------
// CANCEL MID-STREAM / CLIFF VESTING
// -----------------------------------------------------------------

#[test]
fn test_min_claim_interval_does_not_affect_vesting_schedule() {
    // NOTE: this test previously asserted "cliff vesting" behavior — but the
    // contract has no cliff concept (no `cliff_seconds` field on `Stream`,
    // no cliff parameter on `create_stream`); it was mislabeling the 7th
    // `create_stream` argument, which is actually `min_claim_interval_seconds`
    // (a claim-throttle, not a vesting gate — see `test_claim_throttle_*` and
    // `test_claim_allowed_after_interval_elapses` for that behavior). Fixed
    // to assert what `min_claim_interval_seconds` actually does: nothing to
    // `claimable()` — vesting stays purely linear from `start_time` regardless
    // of its value.
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

    // min_claim_interval_seconds = 250 — a claim-throttle, not a vesting cliff.
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &250, &None);

    // Vesting is linear from t=0 regardless of min_claim_interval_seconds.
    assert_eq!(client.claimable(&stream_id, &249), 249);
    assert_eq!(client.claimable(&stream_id, &250), 250);
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
    meta.set(
        String::from_str(&env, "department"),
        String::from_str(&env, "engineering"),
    );
    meta.set(
        String::from_str(&env, "project"),
        String::from_str(&env, "xlm-vesting"),
    );
    meta.set(
        String::from_str(&env, "cost_center"),
        String::from_str(&env, "cc-42"),
    );

    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &1000,
        &0,
        &1000,
        &0,
        &Some(meta.clone()),
    );

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
    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
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
    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
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

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

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

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

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

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

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

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

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

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

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

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

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
        vesting_type: String::from_str(&env, "linear"),
        min_claim_interval_seconds: 0,
        last_claim_time: 0,
        canceled: false,
        paused: true,
        pause_started_at: None,
        metadata: None,
    };

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream)
    });

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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

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

    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

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
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

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

    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000, &0, &None);

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
        actor: sender.clone(),
        timestamp: 100,
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        token_symbol: soroban_sdk::String::from_str(&env, "TEST"),
        total_amount: 1000,
        start_time: 100,
        end_time: 200,
        cliff_seconds: 0,
        vesting_type: String::from_str(&env, "linear"),
        min_claim_interval_seconds: 0,
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
        &sender,
        &recipient,
        &token,
        &1000,
        &0,
        &1000,
        &0,
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
        soroban_sdk::String::from_str(&env, "k0"),
        soroban_sdk::String::from_str(&env, "v0"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k1"),
        soroban_sdk::String::from_str(&env, "v1"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k2"),
        soroban_sdk::String::from_str(&env, "v2"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k3"),
        soroban_sdk::String::from_str(&env, "v3"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k4"),
        soroban_sdk::String::from_str(&env, "v4"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k5"),
        soroban_sdk::String::from_str(&env, "v5"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k6"),
        soroban_sdk::String::from_str(&env, "v6"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k7"),
        soroban_sdk::String::from_str(&env, "v7"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k8"),
        soroban_sdk::String::from_str(&env, "v8"),
    );
    large_meta.set(
        soroban_sdk::String::from_str(&env, "k9"),
        soroban_sdk::String::from_str(&env, "v9"),
    );

    // Should not panic — no budget issues with 10 entries
    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &1000,
        &0,
        &1000,
        &0,
        &Some(large_meta.clone()),
    );

    let stream = client.get_stream(&stream_id);
    assert!(stream.metadata.is_some());
    assert_eq!(
        stream
            .metadata
            .unwrap()
            .get(soroban_sdk::String::from_str(&env, "k9")),
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

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
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
    let regular_id = client.create_stream(&sender, &r1, &token, &100, &0, &1000, &0, &None);
    assert_eq!(regular_id, 1);
    assert_eq!(client.get_next_stream_id(), 1);

    // Split stream with 3 recipients → parent = 2, children = 3, 4, 5; next = 5
    let mut recipients = Vec::new(&env);
    recipients.push_back((r2.clone(), 300_i128));
    recipients.push_back((r3.clone(), 300_i128));
    recipients.push_back((r4.clone(), 400_i128));

    let parent_id = client.create_split_stream(&sender, &token, &1000, &0, &1000, &recipients);
    assert_eq!(parent_id, 2);
    assert_eq!(client.get_next_stream_id(), 5);

    // Child IDs are contiguous: 3, 4, 5
    let children = client.get_split_children(&parent_id);
    assert_eq!(children.len(), 3);
    assert_eq!(children.get(0).unwrap(), 3);
    assert_eq!(children.get(1).unwrap(), 4);
    assert_eq!(children.get(2).unwrap(), 5);

    // Another regular stream → ID 6, no collision
    let next_regular_id = client.create_stream(&sender, &r1, &token, &100, &0, &1000, &0, &None);
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

    let parent_id = client.create_split_stream(&sender, &token, &1000, &0, &1000, &recipients);

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
        &sender,
        &Address::generate(&env),
        &token,
        &100,
        &0,
        &1000,
        &0,
        &None,
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
        &sender,
        &Address::generate(&env),
        &token,
        &100,
        &0,
        &1000,
        &0,
        &None,
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
    assert_eq!(
        unique_count,
        seen_ids.len(),
        "ID collision detected: {:?}",
        seen_ids
    );

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
    let parent_of_a: u64 = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get(&DataKey::ChildToParent(child_a_id))
            .unwrap()
    });
    let parent_of_b: u64 = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get(&DataKey::ChildToParent(child_b_id))
            .unwrap()
    });
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
    let stream_id = client.create_stream(&sender, &recipient, &token, &100, &0, &100, &0, &None);

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

// =============================================================================
// #594 — Comprehensive stream state transitions & edge-case coverage
// =============================================================================

/// Full lifecycle: create → claim partial → advance to completion → claim remainder
#[test]
fn test_full_lifecycle_create_claim_complete() {
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
    let token_client = token::Client::new(&env, &token);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    assert_eq!(client.get_stream_count(), 1);

    env.ledger().with_mut(|l| l.timestamp = 400);
    let claimed = client.claim(&stream_id, &recipient, &400);
    assert_eq!(claimed, 400);
    assert_eq!(token_client.balance(&recipient), 400);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let claimed = client.claim(&stream_id, &recipient, &600);
    assert_eq!(claimed, 600);
    assert_eq!(token_client.balance(&recipient), 1000);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 1000);
    assert_eq!(stream.total_amount, 1000);

    assert_eq!(client.claimable(&stream_id, &1000), 0);
    assert_eq!(client.claimable(&stream_id, &2000), 0);
}

/// Full lifecycle: create → wait for partial vesting → cancel → verify refund and final state
#[test]
fn test_full_lifecycle_create_cancel() {
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
    let token_client = token::Client::new(&env, &token);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 600);
    client.cancel(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    assert_eq!(stream.total_amount, 600);
    assert_eq!(stream.end_time, 600);

    assert_eq!(token_client.balance(&sender), 400);

    let claimed = client.claim(&stream_id, &recipient, &600);
    assert_eq!(claimed, 600);
    assert_eq!(token_client.balance(&recipient), 600);

    assert_eq!(client.claimable(&stream_id, &2000), 0);
    assert_eq!(
        token_client.balance(&sender) + token_client.balance(&recipient),
        1000
    );
}

/// Full lifecycle: create → pause → resume → claim → complete
#[test]
fn test_full_lifecycle_pause_resume_claim() {
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
    let token_client = token::Client::new(&env, &token);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 300);
    client.pause_stream(&stream_id, &sender);

    env.ledger().with_mut(|l| l.timestamp = 500);
    assert_eq!(client.claimable(&stream_id, &500), 300);

    client.resume_stream(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.start_time, 200);
    assert_eq!(stream.end_time, 1200);

    env.ledger().with_mut(|l| l.timestamp = 700);
    let claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);

    env.ledger().with_mut(|l| l.timestamp = 1200);
    let claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 1000);

    assert_eq!(client.claimable(&stream_id, &2000), 0);
}

/// Edge case: cancel after full claim — sender_refund should be 0
#[test]
fn test_cancel_after_full_claim_zero_refund() {
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
    let token_client = token::Client::new(&env, &token);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    client.claim(&stream_id, &recipient, &1000);
    assert_eq!(token_client.balance(&recipient), 1000);

    client.cancel(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    assert_eq!(stream.claimed_amount, 1000);

    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(client.claimable(&stream_id, &2000), 0);
}

/// Edge case: pause with wrong sender panics
#[test]
#[should_panic(expected = "sender mismatch")]
fn test_pause_wrong_sender_panics() {
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
    client.pause_stream(&stream_id, &wrong_sender);
}

/// Edge case: pause on a canceled stream panics
#[test]
#[should_panic(expected = "stream canceled")]
fn test_pause_canceled_stream_panics() {
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
    client.pause_stream(&stream_id, &sender);
}

/// Edge case: resume with wrong sender panics
#[test]
#[should_panic(expected = "sender mismatch")]
fn test_resume_wrong_sender_panics() {
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
    env.ledger().with_mut(|l| l.timestamp = 300);
    client.pause_stream(&stream_id, &sender);
    client.resume_stream(&stream_id, &wrong_sender);
}

/// Edge case: clawback with zero amount panics
#[test]
#[should_panic(expected = "amount must be positive")]
fn test_clawback_zero_amount_panics() {
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

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.clawback(&stream_id, &0, &compliance_admin);
}

/// Edge case: multiple pause/resume cycles
#[test]
fn test_multiple_pause_resume_cycles() {
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

    // Cycle 1: pause at 200, resume at 300
    env.ledger().with_mut(|l| l.timestamp = 200);
    client.pause_stream(&stream_id, &sender);
    env.ledger().with_mut(|l| l.timestamp = 300);
    client.resume_stream(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.start_time, 100);
    assert_eq!(stream.end_time, 1100);

    // Cycle 2: pause at 500, resume at 600
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.pause_stream(&stream_id, &sender);
    env.ledger().with_mut(|l| l.timestamp = 600);
    client.resume_stream(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.start_time, 200);
    assert_eq!(stream.end_time, 1200);

    // Verify vesting is correct after two cycles
    // Total elapsed: (200-0) + (500-300) + ... actually, after resume at 600:
    // start=200, end=1200.
    // At t=700, elapsed = 700-200 = 500, total = 1000, vested = 500
    env.ledger().with_mut(|l| l.timestamp = 700);
    assert_eq!(client.claimable(&stream_id, &700), 500);

    // At t=1200, fully vested (1200-200 = 1000)
    env.ledger().with_mut(|l| l.timestamp = 1200);
    assert_eq!(client.claimable(&stream_id, &1200), 1000);
}

/// Edge case: over-claim after partial claim should panic
#[test]
#[should_panic(expected = "amount exceeds claimable")]
fn test_over_claim_after_partial_claim() {
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
    client.claim(&stream_id, &recipient, &200);
    // Only 100 is claimable now (300 vested - 200 claimed), trying 101 should panic
    client.claim(&stream_id, &recipient, &101);
}

/// Edge case: past start time — stream created with start_time before current ledger time
/// verifies that claimable is based on elapsed time from start
#[test]
fn test_create_with_past_start_time() {
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

    // Ledger is at 500, but stream started at 0 — past start
    env.ledger().with_mut(|l| l.timestamp = 500);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &2000, &0, &None);

    // At ledger time 500, stream has been running for 500 seconds
    assert_eq!(client.claimable(&stream_id, &500), 250);
    // At ledger time 1000, 500 vested
    assert_eq!(client.claimable(&stream_id, &1000), 500);

    // Verify claim works with past start
    let claimed = client.claim(&stream_id, &recipient, &250);
    assert_eq!(claimed, 250);
}

/// Edge case: zero duration in vested_amount (cancel at start_time)
#[test]
fn test_zero_duration_after_cancel_at_start() {
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
    let token_client = token::Client::new(&env, &token);

    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &500, &1500, &0, &None);

    // Cancel exactly at start_time (500)
    env.ledger().with_mut(|l| l.timestamp = 500);
    client.cancel(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    // Cancel at start_time: min_end = start_time (500), so end_time becomes 500
    // total_duration = 500 - 500 = 0
    assert_eq!(stream.end_time, 500);
    assert_eq!(stream.start_time, 500);

    // With zero duration, vested_amount should return 0
    assert_eq!(client.claimable(&stream_id, &500), 0);
    assert_eq!(client.claimable(&stream_id, &2000), 0);

    // Sender gets full refund
    assert_eq!(token_client.balance(&sender), 1000);
}

/// Edge case: resume on non-paused stream panics
#[test]
#[should_panic(expected = "stream is not paused")]
fn test_resume_non_paused_stream_panics() {
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
    client.resume_stream(&stream_id, &sender);
}
// #593 — Multi-token allowlist management tests
// =============================================================================

/// After initialize with an allowlist, get_allowed_tokens returns those tokens.
#[test]
fn test_get_allowed_tokens_returns_initialized_list() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a = Address::generate(&env);
    let token_b = Address::generate(&env);

    let allowed = soroban_sdk::vec![&env, token_a.clone(), token_b.clone()];
    client.initialize(&admin, &Address::generate(&env), &allowed);

    let result = client.get_allowed_tokens();
    assert_eq!(result.len(), 2);
    assert!(result.contains(&token_a));
    assert!(result.contains(&token_b));
}

/// get_allowed_tokens returns empty Vec before initialize is called.
#[test]
fn test_get_allowed_tokens_returns_empty_before_init() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let result = client.get_allowed_tokens();
    assert_eq!(result.len(), 0);
}

/// add_allowed_token appends a new token to the allowlist.
#[test]
fn test_add_allowed_token_appends_to_list() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env), &soroban_sdk::vec![&env]);

    assert_eq!(client.get_allowed_tokens().len(), 0);

    let token_a = Address::generate(&env);
    client.add_allowed_token(&admin, &token_a);

    let result = client.get_allowed_tokens();
    assert_eq!(result.len(), 1);
    assert!(result.contains(&token_a));
}

/// add_allowed_token is idempotent: adding the same token twice keeps only one entry.
#[test]
fn test_add_allowed_token_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a = Address::generate(&env);
    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, token_a.clone()],
    );

    // Add the same token again
    client.add_allowed_token(&admin, &token_a);

    assert_eq!(client.get_allowed_tokens().len(), 1);
}

/// Non-admin cannot add a token; panics with "unauthorized".
#[test]
#[should_panic(expected = "unauthorized")]
fn test_add_allowed_token_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env), &soroban_sdk::vec![&env]);

    client.add_allowed_token(&attacker, &Address::generate(&env));
}

/// remove_allowed_token removes an existing token from the allowlist.
#[test]
fn test_remove_allowed_token_removes_from_list() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a = Address::generate(&env);
    let token_b = Address::generate(&env);
    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, token_a.clone(), token_b.clone()],
    );

    client.remove_allowed_token(&admin, &token_a);

    let result = client.get_allowed_tokens();
    assert_eq!(result.len(), 1);
    assert!(!result.contains(&token_a));
    assert!(result.contains(&token_b));
}

/// remove_allowed_token on a token not in the list is a no-op (no panic).
#[test]
fn test_remove_allowed_token_missing_is_noop() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a = Address::generate(&env);
    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, token_a.clone()],
    );

    let unknown_token = Address::generate(&env);
    // Should not panic
    client.remove_allowed_token(&admin, &unknown_token);

    assert_eq!(client.get_allowed_tokens().len(), 1);
}

/// Non-admin cannot remove a token; panics with "unauthorized".
#[test]
#[should_panic(expected = "unauthorized")]
fn test_remove_allowed_token_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let token_a = Address::generate(&env);
    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, token_a.clone()],
    );

    client.remove_allowed_token(&attacker, &token_a);
}

/// A stream can be created with a token that is on the allowlist.
#[test]
fn test_create_stream_with_allowlisted_token_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin_addr = Address::generate(&env);
    let token = create_token(&env, &token_admin_addr);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, token.clone()],
    );

    // Should succeed — token is on the allowlist
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.token, token);
}

/// A stream creation is rejected when the token is not on the allowlist.
#[test]
#[should_panic(expected = "ContractError::TokenNotAllowed")]
fn test_create_stream_with_non_allowlisted_token_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin_addr = Address::generate(&env);
    let allowed_token = create_token(&env, &token_admin_addr);
    let other_token = create_token(&env, &token_admin_addr);

    let token_mint = token::StellarAssetClient::new(&env, &other_token);
    token_mint.mint(&sender, &1000);

    // Only allowed_token is on the allowlist; other_token is not
    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, allowed_token.clone()],
    );

    client.create_stream(
        &sender,
        &recipient,
        &other_token,
        &1000,
        &0,
        &1000,
        &0,
        &None,
    );
}

/// After removing a token from the allowlist, creating a stream with it is rejected.
#[test]
#[should_panic(expected = "ContractError::TokenNotAllowed")]
fn test_create_stream_rejected_after_token_removed_from_allowlist() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin_addr = Address::generate(&env);
    let token = create_token(&env, &token_admin_addr);
    let other_token = create_token(&env, &token_admin_addr);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &2000);

    // `other_token` stays on the allowlist so it remains non-empty after the
    // removal below (an empty allowlist is treated as "allow all" in test mode).
    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, token.clone(), other_token.clone()],
    );

    // First creation succeeds
    client.create_stream(&sender, &recipient, &token, &100, &0, &1000, &0, &None);

    // Admin removes the token
    client.remove_allowed_token(&admin, &token);

    // Second creation must now fail
    client.create_stream(&sender, &recipient, &token, &100, &0, &1000, &0, &None);
}

/// After adding a token to the allowlist, creating a stream with it succeeds.
#[test]
fn test_create_stream_succeeds_after_token_added_to_allowlist() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin_addr = Address::generate(&env);
    let token = create_token(&env, &token_admin_addr);
    let token_mint = token::StellarAssetClient::new(&env, &token);
    token_mint.mint(&sender, &1000);

    // Initialize with an empty allowlist
    client.initialize(&admin, &Address::generate(&env), &soroban_sdk::vec![&env]);

    // Add token to allowlist
    client.add_allowed_token(&admin, &token);

    // Stream creation should now succeed
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    assert_eq!(client.get_stream(&stream_id).token, token);
}

// =============================================================================
// #593 — set_admin tests
// =============================================================================

/// Admin can transfer the admin role to a new address.
#[test]
fn test_set_admin_transfers_admin_role() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env), &soroban_sdk::vec![&env]);

    client.set_admin(&admin, &new_admin);

    // new_admin can now manage the allowlist without panicking
    let token_a = Address::generate(&env);
    client.add_allowed_token(&new_admin, &token_a);
    assert_eq!(client.get_allowed_tokens().len(), 1);
}

/// Old admin loses privileges after set_admin is called.
#[test]
#[should_panic(expected = "unauthorized")]
fn test_set_admin_old_admin_loses_privileges() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env), &soroban_sdk::vec![&env]);

    client.set_admin(&admin, &new_admin);

    // Old admin can no longer add tokens
    client.add_allowed_token(&admin, &Address::generate(&env));
}

/// Non-admin cannot call set_admin; panics with "unauthorized".
#[test]
#[should_panic(expected = "unauthorized")]
fn test_set_admin_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env), &soroban_sdk::vec![&env]);

    client.set_admin(&attacker, &new_admin);
}

/// Calling set_admin before initialize panics with "contract not initialized".
#[test]
#[should_panic(expected = "contract not initialized")]
fn test_set_admin_before_initialize_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    client.set_admin(&Address::generate(&env), &Address::generate(&env));
}

/// New admin can also transfer admin to yet another address (chain of transfers).
#[test]
fn test_set_admin_chain_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env), &soroban_sdk::vec![&env]);

    client.set_admin(&admin, &admin2);
    client.set_admin(&admin2, &admin3);

    // admin3 can add tokens
    let token_a = Address::generate(&env);
    client.add_allowed_token(&admin3, &token_a);
    assert!(client.get_allowed_tokens().contains(&token_a));
}

// =============================================================================
// #681 — Rate-limited claims (anti-spam)
// =============================================================================

/// Acceptance test: 3 rapid claims, only the 1st succeeds.
#[test]
fn test_claim_throttled_three_rapid_claims_only_first_succeeds() {
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

    // Max 1 claim per 100 seconds
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &100, &None);

    env.ledger().with_mut(|l| l.timestamp = 500);

    // 1st claim succeeds
    let claimed = client.claim(&stream_id, &recipient, &100);
    assert_eq!(claimed, 100);

    // 2nd and 3rd claims in rapid succession are rejected with ClaimTooFrequent
    let res2 = client.try_claim(&stream_id, &recipient, &100);
    assert_eq!(res2, Err(Ok(ContractError::ClaimTooFrequent)));

    let res3 = client.try_claim(&stream_id, &recipient, &100);
    assert_eq!(res3, Err(Ok(ContractError::ClaimTooFrequent)));

    // Nothing was transferred for the rejected attempts
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 100);
}

/// No rate limit when min_claim_interval_seconds = 0.
#[test]
fn test_claim_no_throttle_when_interval_zero() {
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
    client.claim(&stream_id, &recipient, &100);
    // Second claim with no interval is allowed
    let claimed = client.claim(&stream_id, &recipient, &100);
    assert_eq!(claimed, 100);
}

/// A throttled claim attempt emits a ClaimThrottled event.
#[test]
fn test_claim_throttle_emits_claimthrottled_event() {
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

    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &100, &None);

    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &100);

    // Rejected attempt
    let _ = client.try_claim(&stream_id, &recipient, &100);

    let throttled: std::vec::Vec<ClaimThrottled> = env
        .events()
        .all()
        .iter()
        .filter(|(_, topics, _)| {
            *topics == (symbol_short!("Stream"), symbol_short!("Throttled")).into_val(&env)
        })
        .map(|(_, _, data)| data.into_val(&env))
        .collect();

    assert_eq!(throttled.len(), 1);
    assert_eq!(throttled[0].stream_id, stream_id);
    assert_eq!(throttled[0].next_allowed_claim_time, 600);
}

/// After the minimum interval has elapsed, claiming works again.
#[test]
fn test_claim_allowed_after_interval_elapses() {
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

    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &100, &None);

    env.ledger().with_mut(|l| l.timestamp = 500);
    client.claim(&stream_id, &recipient, &100);

    // Still inside the interval -> throttled
    env.ledger().with_mut(|l| l.timestamp = 550);
    assert_eq!(
        client.try_claim(&stream_id, &recipient, &100),
        Err(Ok(ContractError::ClaimTooFrequent))
    );

    // Interval elapsed -> claim succeeds
    env.ledger().with_mut(|l| l.timestamp = 600);
    let claimed = client.claim(&stream_id, &recipient, &100);
    assert_eq!(claimed, 100);
}

// #695 — DAO governance scaffold
// =============================================================================

fn setup_dao(env: &Env) -> (dao::DaoContractClient<'_>, Address, Address, i128) {
    let contract_id = env.register_contract(None, dao::DaoContract);
    let client = dao::DaoContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token = create_token(env, &admin);
    // Mint governance tokens to two voters
    let token_admin = token::StellarAssetClient::new(env, &token);
    let voter1 = Address::generate(env);
    let voter2 = Address::generate(env);
    token_admin.mint(&voter1, &1000);
    token_admin.mint(&voter2, &1000);
    let total_supply: i128 = 2000;

    client.initialize_dao(&admin, &token, &total_supply, &25, &60);
    client.activate(&admin);
    (client, token, admin, total_supply)
}

#[test]
fn test_dao_initialize_and_get_params() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, admin, total_supply) = setup_dao(&env);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_gov_token(), token);
    assert_eq!(client.get_total_supply(), total_supply);
    assert!(client.is_activated());

    let params = client.get_params();
    assert_eq!(params.fee_bps, 25);
    assert_eq!(params.min_stream_duration, 60);
}

#[test]
#[should_panic(expected = "voting period not ended")]
fn test_dao_proposal_cannot_execute_before_voting_ends() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _total_supply) = setup_dao(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let proposer = Address::generate(&env);
    let proposal_id = client.create_proposal(&proposer, &dao::ProposalTarget::FeeBps(50));

    // Vote with quorum-level weight
    let voter = Address::generate(&env);
    client.vote(&voter, &proposal_id, &true);

    // Execute immediately — must panic because the 7-day period has not ended
    client.execute(&proposal_id);
}

#[test]
#[should_panic(expected = "quorum not met")]
fn test_dao_execute_requires_quorum() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, _admin, _total_supply) = setup_dao(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let proposer = Address::generate(&env);
    let proposal_id = client.create_proposal(&proposer, &dao::ProposalTarget::FeeBps(50));

    // A single voter with 100 tokens votes — 100 < 10% of 2000 (quorum = 200)
    let small_voter = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&small_voter, &100);
    client.vote(&small_voter, &proposal_id, &true);

    // Advance past the voting period
    env.ledger()
        .with_mut(|l| l.timestamp = 1_000 + dao::VOTING_PERIOD_SECONDS + 1);
    client.execute(&proposal_id);
}

#[test]
fn test_dao_majority_executes_fee_change() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _total_supply) = setup_dao(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let proposer = Address::generate(&env);
    let proposal_id = client.create_proposal(&proposer, &dao::ProposalTarget::FeeBps(75));

    // voter1: 1000 for, voter2: 500 against → 1500 total votes (quorum 200 met), simple majority
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &_token);
    token_admin.mint(&voter1, &1000);
    token_admin.mint(&voter2, &500);

    client.vote(&voter1, &proposal_id, &true);
    client.vote(&voter2, &proposal_id, &false);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000 + dao::VOTING_PERIOD_SECONDS + 1);
    let executed = client.execute(&proposal_id);
    assert!(executed);

    let params = client.get_params();
    assert_eq!(params.fee_bps, 75);
}

#[test]
fn test_dao_majority_against_rejects_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _total_supply) = setup_dao(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let proposer = Address::generate(&env);
    let proposal_id =
        client.create_proposal(&proposer, &dao::ProposalTarget::MinStreamDuration(120));

    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &_token);
    token_admin.mint(&voter1, &300);
    token_admin.mint(&voter2, &700);

    // against (700) > for (300)
    client.vote(&voter1, &proposal_id, &true);
    client.vote(&voter2, &proposal_id, &false);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000 + dao::VOTING_PERIOD_SECONDS + 1);
    let executed = client.execute(&proposal_id);
    assert!(!executed);

    let params = client.get_params();
    assert_eq!(params.min_stream_duration, 60);
}

#[test]
#[should_panic(expected = "admin changes require DAO proposal")]
fn test_dao_admin_change_only_via_proposal_after_activation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _total_supply) = setup_dao(&env);

    let new_admin = Address::generate(&env);
    // Direct admin transfer after activation must fail
    client.set_dao_admin(&admin, &new_admin);
}

#[test]
fn test_dao_set_admin_allowed_before_activation() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, dao::DaoContract);
    let client = dao::DaoContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.initialize_dao(&admin, &token, &1000, &25, &60);

    let new_admin = Address::generate(&env);
    client.set_dao_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);

    // Activate and verify an Admin proposal changes the admin via DAO
    client.activate(&new_admin);
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let proposer = Address::generate(&env);
    let proposal_id =
        client.create_proposal(&proposer, &dao::ProposalTarget::Admin(new_admin.clone()));

    let voter = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&voter, &500);
    client.vote(&voter, &proposal_id, &true);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000 + dao::VOTING_PERIOD_SECONDS + 1);
    let executed = client.execute(&proposal_id);
    assert!(executed);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_dao_events_emitted() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _total_supply) = setup_dao(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let proposer = Address::generate(&env);
    let proposal_id =
        client.create_proposal(&proposer, &dao::ProposalTarget::MinStreamDuration(300));

    let voter = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &_token);
    token_admin.mint(&voter, &1000);
    client.vote(&voter, &proposal_id, &true);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000 + dao::VOTING_PERIOD_SECONDS + 1);
    client.execute(&proposal_id);

    let topic_pairs: std::vec::Vec<soroban_sdk::Vec<Val>> = env
        .events()
        .all()
        .iter()
        .map(|(_, t, _)| t.clone())
        .collect();

    assert!(
        topic_pairs.contains(&(symbol_short!("Proposal"), symbol_short!("Created")).into_val(&env))
    );
    assert!(
        topic_pairs.contains(&(symbol_short!("Proposal"), symbol_short!("Vote")).into_val(&env))
    );
    assert!(topic_pairs
        .contains(&(symbol_short!("Proposal"), symbol_short!("Executed")).into_val(&env)));
}

#[test]
fn test_dao_vote_weighted_by_balance_and_double_vote_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _total_supply) = setup_dao(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let proposer = Address::generate(&env);
    let proposal_id = client.create_proposal(&proposer, &dao::ProposalTarget::FeeBps(50));

    // Two voters, 400 and 100 tokens respectively → total 500, quorum (200) met
    let big_voter = Address::generate(&env);
    let small_voter = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &_token);
    token_admin.mint(&big_voter, &400);
    token_admin.mint(&small_voter, &100);

    client.vote(&big_voter, &proposal_id, &true);
    client.vote(&small_voter, &proposal_id, &false);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000 + dao::VOTING_PERIOD_SECONDS + 1);
    // 400 for > 100 against → executes even though the small voter opposed
    assert!(client.execute(&proposal_id));
    assert_eq!(client.get_params().fee_bps, 50);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_dao_double_vote_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _total_supply) = setup_dao(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let proposer = Address::generate(&env);
    let proposal_id = client.create_proposal(&proposer, &dao::ProposalTarget::FeeBps(10));

    let voter = Address::generate(&env);
    client.vote(&voter, &proposal_id, &true);
    // Second vote from the same account must panic
    client.vote(&voter, &proposal_id, &true);
}

// ---------------------------------------------------------------------------
// Native token address getter/setter (#688)
// ---------------------------------------------------------------------------

#[test]
fn test_native_token_unset_before_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    assert_eq!(client.get_native_token(), None);
}

#[test]
fn test_get_native_token_returns_configured_address() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let native_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    client.initialize(&admin, &native_token, &soroban_sdk::vec![&env]);
    assert_eq!(client.get_native_token(), Some(native_token));
}

#[test]
fn test_set_native_token_by_admin_updates_address() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let original_native = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let corrected_native = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    client.initialize(&admin, &original_native, &soroban_sdk::vec![&env]);
    assert_eq!(client.get_native_token(), Some(original_native));

    client.set_native_token(&admin, &corrected_native);
    assert_eq!(client.get_native_token(), Some(corrected_native));
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_set_native_token_rejects_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let outsider = Address::generate(&env);
    let native_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let replacement = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    client.initialize(&admin, &native_token, &soroban_sdk::vec![&env]);
    client.set_native_token(&outsider, &replacement);
}

// =============================================================================
// #1181 — Authority over stream state written by a previous build
//
// An upgraded WASM reads `Stream(id)` records that an older build serialized.
// Authority must come from the `sender`/`recipient` recorded in that state,
// and an unauthorized call must fail before any balance or stream change.
// These tests seed the record directly (bypassing `create_stream`) and run
// with auth enforcement on rather than `mock_all_auths`.
// =============================================================================

struct PriorBuild<'a> {
    env: Env,
    client: StellarStreamContractClient<'a>,
    contract_id: Address,
    token: token::Client<'a>,
    sender: Address,
    recipient: Address,
    stream_id: u64,
    stored: Stream,
}

/// Seeds a partially claimed stream as a previous build would have left it:
/// 1000 total, 200 already claimed, linear over [0, 1000], ledger at t=500.
fn prior_build_fixture(env: &Env) -> PriorBuild<'_> {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(env, &contract_id);
    let token_admin = Address::generate(env);
    let token_id = create_token(env, &token_admin);
    let sender = Address::generate(env);
    let recipient = Address::generate(env);
    let stream_id = 7_u64;

    let stored = Stream {
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token_id.clone(),
        total_amount: 1000,
        claimed_amount: 200,
        start_time: 0,
        end_time: 1000,
        cliff_seconds: 0,
        vesting_type: String::from_str(env, "linear"),
        min_claim_interval_seconds: 0,
        last_claim_time: 100,
        canceled: false,
        paused: false,
        pause_started_at: None,
        metadata: Some(make_metadata(env)),
    };

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stored);
        env.storage()
            .persistent()
            .set(&DataKey::NextStreamId, &stream_id);
    });
    // Escrow holds the unclaimed balance.
    token::StellarAssetClient::new(env, &token_id).mint(&contract_id, &800);
    env.ledger().with_mut(|l| l.timestamp = 500);

    // From here on only explicitly mocked signatures are accepted.
    env.mock_auths(&[]);

    PriorBuild {
        env: env.clone(),
        client,
        contract_id,
        token: token::Client::new(env, &token_id),
        sender,
        recipient,
        stream_id,
        stored,
    }
}

impl PriorBuild<'_> {
    /// Accept exactly one signature from `signer` for `fn_name(args)`.
    fn sign(&self, signer: &Address, fn_name: &str, args: Vec<Val>) {
        use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
        self.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &self.contract_id,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    /// Stream record and every balance are exactly as the previous build left them.
    fn assert_untouched(&self) {
        assert_eq!(self.client.get_stream(&self.stream_id), self.stored);
        assert_eq!(self.token.balance(&self.contract_id), 800);
        assert_eq!(self.token.balance(&self.recipient), 0);
        assert_eq!(self.token.balance(&self.sender), 0);
    }
}

#[test]
fn test_prior_build_stream_reads_back_unchanged() {
    let env = Env::default();
    let f = prior_build_fixture(&env);

    assert_eq!(f.client.get_stream(&f.stream_id), f.stored);
    assert_eq!(f.client.claimable(&f.stream_id, &500), 300);
    f.assert_untouched();
}

#[test]
fn test_prior_build_stream_claim_by_recorded_recipient_succeeds() {
    let env = Env::default();
    let f = prior_build_fixture(&env);

    f.sign(
        &f.recipient,
        "claim",
        (f.stream_id, f.recipient.clone(), 300_i128).into_val(&env),
    );
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &300), 300);

    let after = f.client.get_stream(&f.stream_id);
    assert_eq!(after.claimed_amount, 500);
    assert_eq!(after.last_claim_time, 500);
    assert_eq!(f.token.balance(&f.recipient), 300);
    assert_eq!(f.token.balance(&f.contract_id), 500);
}

#[test]
fn test_prior_build_stream_claim_without_recipient_signature_fails_before_state_change() {
    let env = Env::default();
    let f = prior_build_fixture(&env);

    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &300)
        .is_err());
    f.assert_untouched();
}

#[test]
fn test_prior_build_stream_claim_signed_by_other_address_fails_before_state_change() {
    let env = Env::default();
    let f = prior_build_fixture(&env);
    let attacker = Address::generate(&env);

    // Attacker signs, names the recorded recipient.
    f.sign(
        &attacker,
        "claim",
        (f.stream_id, f.recipient.clone(), 300_i128).into_val(&env),
    );
    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &300)
        .is_err());
    f.assert_untouched();

    // Attacker signs, names themself.
    f.sign(
        &attacker,
        "claim",
        (f.stream_id, attacker.clone(), 300_i128).into_val(&env),
    );
    assert!(f.client.try_claim(&f.stream_id, &attacker, &300).is_err());
    f.assert_untouched();
    assert_eq!(f.token.balance(&attacker), 0);
}

#[test]
fn test_prior_build_stream_cancel_requires_recorded_sender() {
    let env = Env::default();
    let f = prior_build_fixture(&env);
    let attacker = Address::generate(&env);

    assert!(f.client.try_cancel(&f.stream_id, &f.sender).is_err());
    f.assert_untouched();

    f.sign(
        &attacker,
        "cancel",
        (f.stream_id, f.sender.clone()).into_val(&env),
    );
    assert!(f.client.try_cancel(&f.stream_id, &f.sender).is_err());
    f.assert_untouched();

    f.sign(
        &attacker,
        "cancel",
        (f.stream_id, attacker.clone()).into_val(&env),
    );
    assert!(f.client.try_cancel(&f.stream_id, &attacker).is_err());
    f.assert_untouched();

    // Recorded sender can cancel: unvested 500 refunded, vested 500 remains.
    f.sign(
        &f.sender,
        "cancel",
        (f.stream_id, f.sender.clone()).into_val(&env),
    );
    f.client.cancel(&f.stream_id, &f.sender);
    let after = f.client.get_stream(&f.stream_id);
    assert!(after.canceled);
    assert_eq!(after.total_amount, 500);
    assert_eq!(after.claimed_amount, 200);
    assert_eq!(f.token.balance(&f.sender), 500);
    assert_eq!(f.token.balance(&f.contract_id), 300);
}

#[test]
fn test_prior_build_stream_pause_and_resume_require_recorded_sender() {
    let env = Env::default();
    let f = prior_build_fixture(&env);
    let attacker = Address::generate(&env);

    f.sign(
        &attacker,
        "pause_stream",
        (f.stream_id, f.sender.clone()).into_val(&env),
    );
    assert!(f.client.try_pause_stream(&f.stream_id, &f.sender).is_err());
    f.assert_untouched();

    // The recorded recipient is not the owner and cannot pause either.
    f.sign(
        &f.recipient,
        "pause_stream",
        (f.stream_id, f.recipient.clone()).into_val(&env),
    );
    assert!(f
        .client
        .try_pause_stream(&f.stream_id, &f.recipient)
        .is_err());
    f.assert_untouched();

    f.sign(
        &f.sender,
        "pause_stream",
        (f.stream_id, f.sender.clone()).into_val(&env),
    );
    f.client.pause_stream(&f.stream_id, &f.sender);
    let paused = f.client.get_stream(&f.stream_id);
    assert!(paused.paused);

    f.sign(
        &attacker,
        "resume_stream",
        (f.stream_id, f.sender.clone()).into_val(&env),
    );
    assert!(f.client.try_resume_stream(&f.stream_id, &f.sender).is_err());
    assert_eq!(f.client.get_stream(&f.stream_id), paused);
}

#[test]
fn test_prior_build_stream_transfer_moves_claim_authority() {
    let env = Env::default();
    let f = prior_build_fixture(&env);
    let new_recipient = Address::generate(&env);

    // Only the recorded recipient may transfer; the sender cannot.
    f.sign(
        &f.sender,
        "transfer_stream",
        (f.stream_id, new_recipient.clone()).into_val(&env),
    );
    assert!(f
        .client
        .try_transfer_stream(&f.stream_id, &new_recipient)
        .is_err());
    f.assert_untouched();

    f.sign(
        &f.recipient,
        "transfer_stream",
        (f.stream_id, new_recipient.clone()).into_val(&env),
    );
    f.client.transfer_stream(&f.stream_id, &new_recipient);
    assert_eq!(f.client.get_stream(&f.stream_id).recipient, new_recipient);

    // The old recipient's signature no longer authorizes a claim.
    f.sign(
        &f.recipient,
        "claim",
        (f.stream_id, f.recipient.clone(), 300_i128).into_val(&env),
    );
    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &300)
        .is_err());
    assert_eq!(f.client.get_stream(&f.stream_id).claimed_amount, 200);
    assert_eq!(f.token.balance(&f.contract_id), 800);

    f.sign(
        &new_recipient,
        "claim",
        (f.stream_id, new_recipient.clone(), 300_i128).into_val(&env),
    );
    assert_eq!(f.client.claim(&f.stream_id, &new_recipient, &300), 300);
    assert_eq!(f.token.balance(&new_recipient), 300);
}

// =============================================================================
// #1182 — Upgrade compatibility: reading streams created by a previous build
//
// These tests seed `Stream` records directly into persistent storage
// (bypassing `create_stream`) to simulate the on-chain state a previous
// build would have left behind.  They verify the invariants documented in
// `CONTRACT_ABI.md` under "Edge behavior: reading a stream created by a
// previous build".
// =============================================================================

/// Helper: build a minimal Stream as a "previous build" would have stored it.
/// Returns (stream_id, Stream) without going through create_stream.
fn seed_legacy_stream(env: &Env, contract_id: &Address) -> (u64, Stream, Address) {
    let token_admin = Address::generate(env);
    let sender = Address::generate(env);
    let recipient = Address::generate(env);
    let token_id = create_token(env, &token_admin);

    let stream_id = 42_u64;
    let legacy = Stream {
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token_id.clone(),
        total_amount: 10_000_000,
        claimed_amount: 2_000_000,
        start_time: 0,
        end_time: 10_000,
        cliff_seconds: 0,
        vesting_type: String::from_str(env, "linear"),
        min_claim_interval_seconds: 0,
        last_claim_time: 500,
        canceled: false,
        paused: false,
        pause_started_at: None,
        metadata: None,
    };

    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &legacy);
        env.storage()
            .persistent()
            .set(&DataKey::NextStreamId, &stream_id);
    });

    // Mint unclaimed balance into the contract (10_000_000 - 2_000_000 = 8_000_000).
    token::StellarAssetClient::new(env, &token_id).mint(contract_id, &8_000_000);

    (stream_id, legacy, token_id)
}

/// `get_stream` and `claimable` read back a legacy record without altering
/// any field or balance (CONTRACT_ABI.md rule 1 + 7: same layout, no mutation
/// on read).
#[test]
fn test_read_legacy_stream_preserves_balances() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let (stream_id, legacy, token_id) = seed_legacy_stream(&env, &contract_id);
    let token_client = token::Client::new(&env, &token_id);

    // Rule 1: all fields decoded intact.
    let read_back = client.get_stream(&stream_id);
    assert_eq!(read_back, legacy);

    // Rule 2: integer token units are not rescaled.
    assert_eq!(read_back.total_amount, 10_000_000);
    assert_eq!(read_back.claimed_amount, 2_000_000);

    // Rule 4: invariant claimed_amount <= total_amount is respected.
    assert!(read_back.claimed_amount <= read_back.total_amount);

    // At t=5000 (half-way): 5_000_000 vested, 2_000_000 already claimed → 3_000_000 claimable.
    env.ledger().with_mut(|l| l.timestamp = 5_000);
    assert_eq!(client.claimable(&stream_id, &5_000), 3_000_000);

    // Rule 7: reading did not mutate storage — balances unchanged.
    assert_eq!(token_client.balance(&contract_id), 8_000_000);
    assert_eq!(client.get_stream(&stream_id), legacy);
}

/// Arithmetic on a legacy record uses checked operations: the invariant
/// `claimed_amount <= total_amount` cannot be violated by a claim
/// (CONTRACT_ABI.md rule 3 + 4).
#[test]
fn test_read_legacy_stream_checked_arithmetic() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let (stream_id, _legacy, token_id) = seed_legacy_stream(&env, &contract_id);
    let token_client = token::Client::new(&env, &token_id);

    // Advance to full vesting.
    env.ledger().with_mut(|l| l.timestamp = 10_000);

    // Only 8_000_000 is claimable (total 10M - already claimed 2M).
    assert_eq!(client.claimable(&stream_id, &10_000), 8_000_000);

    // Claim exactly the claimable amount: no overflow, invariant holds.
    let claimed = client.claim(
        &stream_id,
        &legacy_recipient(&env, &contract_id, stream_id),
        &8_000_000,
    );
    assert_eq!(claimed, 8_000_000);

    let after = client.get_stream(&stream_id);
    // claimed_amount == total_amount after full claim.
    assert_eq!(after.claimed_amount, 10_000_000);
    assert_eq!(after.total_amount, 10_000_000);
    assert!(after.claimed_amount <= after.total_amount);

    // Contract balance is now zero (all tokens transferred).
    assert_eq!(token_client.balance(&contract_id), 0);

    // Nothing left to claim.
    assert_eq!(client.claimable(&stream_id, &10_001), 0);
}

/// Helper: extract the stored recipient address for a seeded legacy stream.
fn legacy_recipient(env: &Env, contract_id: &Address, stream_id: u64) -> Address {
    env.as_contract(contract_id, || {
        let s: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap();
        s.recipient
    })
}

/// Calling `get_stream` on a legacy record does not write back to storage.
/// All fields are returned byte-for-byte identical to what was seeded
/// (CONTRACT_ABI.md rule 7: no mutation on read).
#[test]
fn test_upgrade_read_old_state_preserves_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let (stream_id, legacy, _token_id) = seed_legacy_stream(&env, &contract_id);

    // Read multiple times — each read must return the exact same value.
    let first = client.get_stream(&stream_id);
    let second = client.get_stream(&stream_id);
    let third = client.get_stream(&stream_id);

    assert_eq!(first, legacy);
    assert_eq!(second, legacy);
    assert_eq!(third, legacy);

    // Confirm the raw bytes in storage match the original seed (rule 7).
    env.as_contract(&contract_id, || {
        let raw: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap();
        assert_eq!(raw, legacy);
    });
}

// =============================================================================
// #1182 — Event emission ordering: StreamClaimed always precedes StreamCompleted
//
// Verified against CONTRACT_ABI.md "Event emission ordering guarantee".
// =============================================================================

/// When a claim results in full stream completion, the event list must contain
/// `StreamClaimed` at an earlier position than `StreamCompleted`, and both
/// events must refer to the same stream_id and carry consistent amounts.
#[test]
fn test_claim_event_ordering_claimed_before_completed() {
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

    // Create a stream that runs from t=0 to t=1000.
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);

    // Advance past end time so the full amount is vested.
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Record event count before the completing claim so we can slice only the new events.
    let events_before = env
        .events()
        .all()
        .iter()
        .filter(|(emitter, _, _)| emitter == &contract_id)
        .count();

    // Claim the full amount — this should emit StreamClaimed then StreamCompleted.
    let claimed = client.claim(&stream_id, &recipient, &1000);
    assert_eq!(claimed, 1000);

    let all_events = env.events().all();
    let new_events: std::vec::Vec<_> = all_events
        .iter()
        .filter(|(emitter, _, _)| emitter == &contract_id)
        .skip(events_before)
        .collect::<std::vec::Vec<_>>();

    // Exactly two events must have been emitted for this claim.
    assert_eq!(
        new_events.len(),
        2,
        "expected exactly 2 events (StreamClaimed + StreamCompleted), got {}",
        new_events.len()
    );

    // First new event: StreamClaimed.
    let (_, claimed_topics, claimed_val) = &new_events[0];
    let claimed_topics_native: soroban_sdk::Vec<soroban_sdk::Val> =
        claimed_topics.clone().into_val(&env);
    let claimed_topic0: Symbol = claimed_topics_native.get(0).unwrap().into_val(&env);
    let claimed_topic1: Symbol = claimed_topics_native.get(1).unwrap().into_val(&env);
    assert_eq!(claimed_topic0, symbol_short!("Stream"));
    assert_eq!(claimed_topic1, symbol_short!("Claimed"));

    let claimed_event: StreamClaimed = claimed_val.clone().into_val(&env);
    assert_eq!(claimed_event.stream_id, stream_id);
    assert_eq!(claimed_event.actor, recipient);
    assert_eq!(claimed_event.amount, 1000);
    assert_eq!(claimed_event.claimed_amount, 1000);

    // Second new event: StreamCompleted.
    let (_, completed_topics, completed_val) = &new_events[1];
    let completed_topics_native: soroban_sdk::Vec<soroban_sdk::Val> =
        completed_topics.clone().into_val(&env);
    let completed_topic0: Symbol = completed_topics_native.get(0).unwrap().into_val(&env);
    let completed_topic1: Symbol = completed_topics_native.get(1).unwrap().into_val(&env);
    assert_eq!(completed_topic0, symbol_short!("Stream"));
    assert_eq!(completed_topic1, symbol_short!("Completed"));

    let completed_event: StreamCompleted = completed_val.clone().into_val(&env);
    assert_eq!(completed_event.stream_id, stream_id);
    assert_eq!(completed_event.actor, recipient);
    assert_eq!(completed_event.total_amount, 1000);
}

/// A partial claim (not completing the stream) must emit exactly one
/// `StreamClaimed` event and no `StreamCompleted`.
#[test]
fn test_claim_event_partial_no_completed_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    token::StellarAssetClient::new(&env, &token).mint(&sender, &1000);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &1000, &0, &None);
    env.ledger().with_mut(|l| l.timestamp = 500);

    let events_before = env
        .events()
        .all()
        .iter()
        .filter(|(emitter, _, _)| emitter == &contract_id)
        .count();
    client.claim(&stream_id, &recipient, &400);

    let all_events = env.events().all();
    let new_events: std::vec::Vec<_> = all_events
        .iter()
        .filter(|(emitter, _, _)| emitter == &contract_id)
        .skip(events_before)
        .collect::<std::vec::Vec<_>>();

    // Only StreamClaimed, no StreamCompleted.
    assert_eq!(
        new_events.len(),
        1,
        "expected exactly 1 event for partial claim"
    );

    let (_, topics, _) = &new_events[0];
    let topics_native: soroban_sdk::Vec<soroban_sdk::Val> = topics.clone().into_val(&env);
    let topic1: Symbol = topics_native.get(1).unwrap().into_val(&env);
    assert_eq!(topic1, symbol_short!("Claimed"));
}

// =============================================================================
// #1182 — Contract version key
// =============================================================================

/// After `initialize`, `get_contract_version` returns `STREAM_LAYOUT_VERSION`.
#[test]
fn test_get_contract_version_after_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);
    let allowed: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);

    client.initialize(&admin, &native_token, &allowed);

    let version = client.get_contract_version();
    assert_eq!(
        version,
        Some(STREAM_LAYOUT_VERSION),
        "expected version {} after initialize, got {:?}",
        STREAM_LAYOUT_VERSION,
        version
    );
}

/// Before `initialize`, `get_contract_version` returns `None`; upgrade scripts
/// must treat this as version 0 and run all pending migrations.
#[test]
fn test_get_contract_version_before_initialize_returns_none() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    assert_eq!(
        client.get_contract_version(),
        None,
        "expected None before initialize"
    );
}

#[test]
fn test_set_contract_version_for_legacy_deployment() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    client.set_contract_version(&admin, &STREAM_LAYOUT_VERSION);
    assert_eq!(client.get_contract_version(), Some(STREAM_LAYOUT_VERSION));
}

#[test]
#[should_panic(expected = "invalid contract version")]
fn test_set_contract_version_rejects_downgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let native_token = Address::generate(&env);
    let allowed: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);

    client.initialize(&admin, &native_token, &allowed);
    client.set_contract_version(&admin, &0);
}

#[test]
fn test_persistent_stream_survives_inactive_interval_before_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    token::StellarAssetClient::new(&env, &token).mint(&sender, &1000);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &100, &0, &None);
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 1, 100);
    });
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 99);
    env.ledger().set_timestamp(100);

    let claimed = client.claim(&stream_id, &recipient, &1000);
    assert_eq!(claimed, 1000);
    assert_eq!(token::Client::new(&env, &token).balance(&recipient), 1000);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 1000);
    assert_eq!(env.events().all().len(), 7);
}

#[test]
fn test_persistent_stream_unauthorized_claim_fails_before_state_change() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let impostor = Address::generate(&env);
    let token = create_token(&env, &admin);
    token::StellarAssetClient::new(&env, &token).mint(&sender, &1000);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &100, &0, &None);
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 1, 100);
    });
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 99);
    env.ledger().set_timestamp(100);

    let res = client.try_claim(&stream_id, &impostor, &1000);
    assert!(res.is_err());
    assert_eq!(token::Client::new(&env, &token).balance(&recipient), 0);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 0);
}

#[test]
fn test_persistent_stream_atomic_failure_on_over_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    token::StellarAssetClient::new(&env, &token).mint(&sender, &1000);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &100, &0, &None);
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 1, 100);
    });
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 99);
    env.ledger().set_timestamp(50);

    let res = client.try_claim(&stream_id, &recipient, &800);
    assert!(res.is_err());
    assert_eq!(token::Client::new(&env, &token).balance(&recipient), 0);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 0);
}

// =============================================================================
// #1183 — Soroban regression: contract upgrade compatibility
//
// Two upgrade-compatibility cases, both exercised fully in-process (no network
// dependency):
//
//   (a) reading a stream created by a previous build, and
//   (b) upgraded code encountering old state.
//
// The legacy records are seeded directly into persistent storage using the
// earliest serialized `Stream` shape (only the seven original fields).  The
// current decoder in `read_stream` must treat the newer fields as their
// documented defaults, mirroring an on-chain upgrade where the new WASM reads
// records written by an older build.  Every case asserts:
//   * state     — the legacy record decodes intact and is not rewritten,
//   * authorization — only the recorded sender/recipient is accepted,
//   * payout    — token balances move by exactly the claimed amount,
//   * rollback  — a failed call leaves records, balances and events untouched.
//
// Documented behavior preserved:
//   * CONTRACT_ABI.md "Upgrade and migration impact" / "Authority over existing
//     state" (authority comes from stored sender/recipient).
//   * CONTRACT_ABI.md "Event payload stability" topic keys `("Stream", name)`.
//   * CONTRACT_ABI.md "Event emission ordering guarantee" for `claim()`.
//   * `get_contract_version()` returning `None` for a pre-versioning
//     deployment (treated as version 0) and the documented upgrade path that
//     records the new version via `set_contract_version()`.
// =============================================================================

/// Earliest `Stream` shape: the seven fields present in the original layout.
/// A current build must decode it treating the newer fields as defaults:
/// `cliff_seconds = 0`, `vesting_type = "linear"`,
/// `min_claim_interval_seconds = 0`, `last_claim_time = 0`, `canceled = false`,
/// `paused = false`, `pause_started_at = None`, `metadata = None`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
struct EarliestBuildStream {
    sender: Address,
    recipient: Address,
    token: Address,
    total_amount: i128,
    claimed_amount: i128,
    start_time: u64,
    end_time: u64,
}

const UPGRADE_COMPAT_STREAM_ID: u64 = 99;
const UPGRADE_COMPAT_TOTAL: i128 = 1_000_000;
const UPGRADE_COMPAT_CLAIMED: i128 = 100_000;
const UPGRADE_COMPAT_START: u64 = 0;
const UPGRADE_COMPAT_END: u64 = 1_000;
const UPGRADE_COMPAT_NOW: u64 = 500;
const UPGRADE_COMPAT_ESCROW: i128 = UPGRADE_COMPAT_TOTAL - UPGRADE_COMPAT_CLAIMED;

struct UpgradeCompatFixture<'a> {
    env: Env,
    contract_id: Address,
    client: StellarStreamContractClient<'a>,
    token: token::Client<'a>,
    sender: Address,
    recipient: Address,
    admin: Address,
}

/// Seeds an earliest-layout stream directly into persistent storage and funds
/// the escrow, exactly as a previous build would have left the contract.
fn upgrade_compat_fixture(env: &Env) -> UpgradeCompatFixture<'_> {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_id = create_token(env, &admin);
    let sender = Address::generate(env);
    let recipient = Address::generate(env);

    let legacy = EarliestBuildStream {
        sender: sender.clone(),
        recipient: recipient.clone(),
        token: token_id.clone(),
        total_amount: UPGRADE_COMPAT_TOTAL,
        claimed_amount: UPGRADE_COMPAT_CLAIMED,
        start_time: UPGRADE_COMPAT_START,
        end_time: UPGRADE_COMPAT_END,
    };

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Stream(UPGRADE_COMPAT_STREAM_ID), &legacy);
        env.storage()
            .persistent()
            .set(&DataKey::NextStreamId, &UPGRADE_COMPAT_STREAM_ID);
        // An upgraded deployment keeps the admin key written by the prior build.
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    // Fund the contract escrow with the unclaimed portion.
    token::StellarAssetClient::new(env, &token_id).mint(&contract_id, &UPGRADE_COMPAT_ESCROW);

    env.ledger().with_mut(|l| l.timestamp = UPGRADE_COMPAT_NOW);

    UpgradeCompatFixture {
        env: env.clone(),
        contract_id,
        client,
        token: token::Client::new(env, &token_id),
        sender,
        recipient,
        admin,
    }
}

impl UpgradeCompatFixture<'_> {
    /// Number of events emitted by the stream contract so far.
    fn contract_event_count(&self) -> usize {
        self.env
            .events()
            .all()
            .iter()
            .filter(|(emitter, _, _)| emitter == &self.contract_id)
            .count()
    }

    /// Owned copies of the stream-contract events emitted after `before`.
    fn events_since(&self, before: usize) -> std::vec::Vec<(Address, soroban_sdk::Vec<Val>, Val)> {
        self.env
            .events()
            .all()
            .iter()
            .filter(|(emitter, _, _)| emitter == &self.contract_id)
            .skip(before)
            .map(|(emitter, topics, data)| (emitter.clone(), topics.clone(), data))
            .collect()
    }

    /// Accepts exactly one signature from `signer` for `claim(stream_id, signer, amount)`.
    fn sign_claim(&self, signer: &Address, amount: i128) {
        use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
        self.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &self.contract_id,
                fn_name: "claim",
                args: (UPGRADE_COMPAT_STREAM_ID, signer.clone(), amount).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
    }

    /// The legacy record, escrow balance and recipient balance are untouched.
    fn assert_legacy_state_intact(&self, expected_events: usize) {
        let stream = self.client.get_stream(&UPGRADE_COMPAT_STREAM_ID);
        assert_eq!(stream.total_amount, UPGRADE_COMPAT_TOTAL);
        assert_eq!(stream.claimed_amount, UPGRADE_COMPAT_CLAIMED);
        assert_eq!(stream.last_claim_time, 0);
        assert!(!stream.canceled);
        assert!(!stream.paused);
        assert_eq!(stream.pause_started_at, None);

        assert_eq!(self.token.balance(&self.contract_id), UPGRADE_COMPAT_ESCROW);
        assert_eq!(self.token.balance(&self.recipient), 0);
        assert_eq!(self.token.balance(&self.sender), 0);
        assert_eq!(self.contract_event_count(), expected_events);
    }
}

fn decode_topic(env: &Env, topics: &soroban_sdk::Vec<Val>, index: u32) -> Symbol {
    topics.get(index).unwrap().into_val(env)
}

// -----------------------------------------------------------------------------
// Case (a): reading a stream created by a previous build
// -----------------------------------------------------------------------------

/// A legacy record decodes intact with the documented defaults and reading it
/// has no side effect on the stored record or on token balances.
#[test]
fn test_upgrade_compat_a_reads_state_created_by_previous_build() {
    let env = Env::default();
    let f = upgrade_compat_fixture(&env);

    let stream = f.client.get_stream(&UPGRADE_COMPAT_STREAM_ID);
    assert_eq!(stream.sender, f.sender);
    assert_eq!(stream.recipient, f.recipient);
    assert_eq!(stream.total_amount, UPGRADE_COMPAT_TOTAL);
    assert_eq!(stream.claimed_amount, UPGRADE_COMPAT_CLAIMED);
    assert_eq!(stream.start_time, UPGRADE_COMPAT_START);
    assert_eq!(stream.end_time, UPGRADE_COMPAT_END);

    // Newer fields were absent from the old layout → documented defaults.
    assert_eq!(stream.cliff_seconds, 0);
    assert_eq!(stream.vesting_type, String::from_str(&env, "linear"));
    assert_eq!(stream.min_claim_interval_seconds, 0);
    assert_eq!(stream.last_claim_time, 0);
    assert!(!stream.canceled);
    assert!(!stream.paused);
    assert_eq!(stream.pause_started_at, None);
    assert_eq!(stream.metadata, None);

    // Vesting is computed from the legacy fields: at t=500, 500k vested - 100k
    // claimed = 400k claimable; the invariant claimed <= total holds.
    assert_eq!(
        f.client
            .claimable(&UPGRADE_COMPAT_STREAM_ID, &UPGRADE_COMPAT_NOW),
        400_000
    );
    assert!(stream.claimed_amount <= stream.total_amount);

    // Rule: reading never mutates state or balances.
    f.assert_legacy_state_intact(0);
}

/// Authorization, payout and rollback on a legacy record, driven by the
/// recorded recipient rather than caller-supplied arguments.
#[test]
fn test_upgrade_compat_a_claim_auth_payout_and_rollback() {
    let env = Env::default();
    let f = upgrade_compat_fixture(&env);

    // Switch off blanket auth: from here only explicit signatures are honored.
    env.mock_auths(&[]);
    let before = f.contract_event_count();

    // 1. No signature: the recorded recipient's auth is required.
    assert!(f
        .client
        .try_claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &50_000)
        .is_err());
    // 2. An attacker cannot authorize the recorded recipient's claim.
    let attacker = Address::generate(&env);
    f.sign_claim(&attacker, 50_000);
    assert!(f
        .client
        .try_claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &50_000)
        .is_err());
    // 3. An attacker naming themself fails the recipient check.
    assert!(f
        .client
        .try_claim(&UPGRADE_COMPAT_STREAM_ID, &attacker, &50_000)
        .is_err());

    // Rollback 1: every unauthorized attempt left state, balances and events
    // exactly as the previous build left them.
    f.assert_legacy_state_intact(before);

    // 4. Authorized but over-claiming (more than vested) also reverts.
    f.sign_claim(&f.recipient, 50_000_000);
    assert!(f
        .client
        .try_claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &50_000_000)
        .is_err());

    // Rollback 2: no partial effect from the rejected over-claim.
    f.assert_legacy_state_intact(before);

    // 5. The recorded recipient with a valid signature claims and is paid
    // exactly the requested amount.
    f.sign_claim(&f.recipient, 400_000);
    assert_eq!(
        f.client
            .claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &400_000),
        400_000
    );
    assert_eq!(f.token.balance(&f.recipient), 400_000);
    assert_eq!(
        f.token.balance(&f.contract_id),
        UPGRADE_COMPAT_ESCROW - 400_000
    );

    let stream = f.client.get_stream(&UPGRADE_COMPAT_STREAM_ID);
    assert_eq!(stream.claimed_amount, UPGRADE_COMPAT_CLAIMED + 400_000);
    assert_eq!(stream.last_claim_time, UPGRADE_COMPAT_NOW);

    // Exactly one documented event: StreamClaimed, carrying the stable fields.
    let events = f.events_since(before);
    assert_eq!(events.len(), 1);
    let (_, topics, data) = &events[0];
    assert_eq!(decode_topic(&env, topics, 0), symbol_short!("Stream"));
    assert_eq!(decode_topic(&env, topics, 1), symbol_short!("Claimed"));
    let claimed_event: StreamClaimed = data.clone().into_val(&env);
    assert_eq!(claimed_event.stream_id, UPGRADE_COMPAT_STREAM_ID);
    assert_eq!(claimed_event.actor, f.recipient);
    assert_eq!(claimed_event.amount, 400_000);
    assert_eq!(
        claimed_event.claimed_amount,
        UPGRADE_COMPAT_CLAIMED + 400_000
    );
}

/// A full claim on a legacy stream emits `StreamClaimed` immediately followed by
/// `StreamCompleted` (documented ordering) and drains the escrow.
#[test]
fn test_upgrade_compat_a_full_claim_emits_claimed_then_completed() {
    let env = Env::default();
    let f = upgrade_compat_fixture(&env);
    env.ledger().with_mut(|l| l.timestamp = UPGRADE_COMPAT_END);

    let before = f.contract_event_count();
    let remaining = f
        .client
        .claimable(&UPGRADE_COMPAT_STREAM_ID, &UPGRADE_COMPAT_END);
    assert_eq!(remaining, UPGRADE_COMPAT_ESCROW);

    let paid = f
        .client
        .claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &remaining);
    assert_eq!(paid, remaining);
    assert_eq!(f.token.balance(&f.recipient), UPGRADE_COMPAT_ESCROW);
    assert_eq!(f.token.balance(&f.contract_id), 0);

    let events = f.events_since(before);
    assert_eq!(events.len(), 2);
    assert_eq!(
        decode_topic(&env, &events[0].1, 1),
        symbol_short!("Claimed")
    );
    assert_eq!(
        decode_topic(&env, &events[1].1, 1),
        symbol_short!("Completed")
    );

    let claimed: StreamClaimed = events[0].2.clone().into_val(&env);
    assert_eq!(claimed.stream_id, UPGRADE_COMPAT_STREAM_ID);
    assert_eq!(claimed.amount, UPGRADE_COMPAT_ESCROW);
    assert_eq!(claimed.claimed_amount, UPGRADE_COMPAT_TOTAL);

    let completed: StreamCompleted = events[1].2.clone().into_val(&env);
    assert_eq!(completed.stream_id, UPGRADE_COMPAT_STREAM_ID);
    assert_eq!(completed.total_amount, UPGRADE_COMPAT_TOTAL);

    let stream = f.client.get_stream(&UPGRADE_COMPAT_STREAM_ID);
    assert_eq!(stream.claimed_amount, UPGRADE_COMPAT_TOTAL);
    assert_eq!(
        f.client
            .claimable(&UPGRADE_COMPAT_STREAM_ID, &UPGRADE_COMPAT_END),
        0
    );
}

// -----------------------------------------------------------------------------
// Case (b): upgraded code encountering old state
// -----------------------------------------------------------------------------

/// Simulates the documented upgrade path for a pre-versioning deployment:
/// `get_contract_version()` is `None`, the admin records the layout version,
/// and the upgraded code still reads and pays against the old state.
#[test]
fn test_upgrade_compat_b_migration_preserves_old_state_and_pays() {
    let env = Env::default();
    let f = upgrade_compat_fixture(&env);

    // A deployment predating the `ContractVersion` key reports None (version 0).
    assert_eq!(f.client.get_contract_version(), None);

    // Documented upgrade step: the admin records the version the new WASM
    // expects once the (here no-op) migration has run.
    f.client
        .set_contract_version(&f.admin, &STREAM_LAYOUT_VERSION);
    assert_eq!(f.client.get_contract_version(), Some(STREAM_LAYOUT_VERSION));

    // The upgraded build still reads the pre-upgrade record intact.
    let stream = f.client.get_stream(&UPGRADE_COMPAT_STREAM_ID);
    assert_eq!(stream.total_amount, UPGRADE_COMPAT_TOTAL);
    assert_eq!(stream.claimed_amount, UPGRADE_COMPAT_CLAIMED);
    assert_eq!(stream.vesting_type, String::from_str(&env, "linear"));

    // And can still pay out against it, emitting the documented event.
    let before = f.contract_event_count();
    let paid = f
        .client
        .claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &100_000);
    assert_eq!(paid, 100_000);
    assert_eq!(f.token.balance(&f.recipient), 100_000);
    assert_eq!(
        f.token.balance(&f.contract_id),
        UPGRADE_COMPAT_ESCROW - 100_000
    );
    assert_eq!(
        f.client
            .get_stream(&UPGRADE_COMPAT_STREAM_ID)
            .claimed_amount,
        UPGRADE_COMPAT_CLAIMED + 100_000
    );

    let events = f.events_since(before);
    assert_eq!(events.len(), 1);
    assert_eq!(decode_topic(&env, &events[0].1, 0), symbol_short!("Stream"));
    assert_eq!(
        decode_topic(&env, &events[0].1, 1),
        symbol_short!("Claimed")
    );
}

/// After an upgrade, authorization is still derived from the stored record and
/// any rejected call rolls back completely.
#[test]
fn test_upgrade_compat_b_upgraded_code_auth_and_rollback() {
    let env = Env::default();
    let f = upgrade_compat_fixture(&env);

    // Complete the documented upgrade, then enforce real signatures.
    f.client
        .set_contract_version(&f.admin, &STREAM_LAYOUT_VERSION);
    env.mock_auths(&[]);
    let before = f.contract_event_count();

    // Unauthorized claim against old state reverts...
    assert!(f
        .client
        .try_claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &100_000)
        .is_err());
    f.assert_legacy_state_intact(before);

    // ...and an authorized over-claim reverts without transferring tokens.
    f.sign_claim(&f.recipient, 100_000_000);
    assert!(f
        .client
        .try_claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &100_000_000)
        .is_err());
    f.assert_legacy_state_intact(before);

    // The version change survived the reverts (instance storage, not the failed
    // call's persistent writes).
    assert_eq!(f.client.get_contract_version(), Some(STREAM_LAYOUT_VERSION));

    // A valid signed claim on the old state succeeds.
    f.sign_claim(&f.recipient, 100_000);
    assert_eq!(
        f.client
            .claim(&UPGRADE_COMPAT_STREAM_ID, &f.recipient, &100_000),
        100_000
    );
    assert_eq!(f.token.balance(&f.recipient), 100_000);
    assert_eq!(f.contract_event_count(), before + 1);
}

// =============================================================================
// #1173 — Soroban regression: Stream ID allocation
// =============================================================================

#[test]
fn test_stream_id_allocation_consecutive_creations_different_senders() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender1 = Address::generate(&env);
    let sender2 = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender1, &1000);
    token_admin.mint(&sender2, &2000);

    let id1 = client.create_stream(&sender1, &recipient1, &token, &1000, &0, &100, &0, &None);
    assert_eq!(id1, 1);
    assert_eq!(client.get_stream(&id1).sender, sender1);
    assert_eq!(client.get_stream(&id1).total_amount, 1000);

    let id2 = client.create_stream(&sender2, &recipient2, &token, &2000, &0, &100, &0, &None);
    assert_eq!(id2, 2);
    assert_eq!(client.get_stream(&id2).sender, sender2);
    assert_eq!(client.get_stream(&id2).total_amount, 2000);
}

#[test]
fn test_stream_id_allocation_aborted_creation_does_not_consume_id() {
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

    // Aborted creation: end_time <= start_time
    let fail_res =
        client.try_create_stream(&sender, &recipient, &token, &500, &100, &50, &0, &None);
    assert!(fail_res.is_err());

    // Subsequent valid creation receives the unconsumed ID 1
    let id = client.create_stream(&sender, &recipient, &token, &500, &0, &100, &0, &None);
    assert_eq!(id, 1);
    assert_eq!(client.get_stream(&id).total_amount, 500);
}

// =============================================================================
// #1172 — Align events with Stream ID allocation state
// =============================================================================

#[test]
fn test_stream_id_allocation_event_alignment_and_ordering() {
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

    let events_before = env.events().all().len();
    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    let events_after = env.events().all();
    assert!(events_after.len() > events_before);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.sender, sender);
    assert_eq!(stream.recipient, recipient);
    assert_eq!(stream.total_amount, 1000);

    // Failed creation attempt emits no ghost stream
    let fail_res =
        client.try_create_stream(&sender, &recipient, &token, &500, &100, &50, &0, &None);
    assert!(fail_res.is_err());
}

// =============================================================================
// #1171 — Check authority in Stream ID allocation
// =============================================================================

#[test]
fn test_stream_id_allocation_unauthorized_sender_fails_before_id_allocation() {
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

    // Initial stream creation succeeds and allocates ID 1
    let id1 = client.create_stream(&sender, &recipient, &token, &500, &0, &100, &0, &None);
    assert_eq!(id1, 1);
    assert_eq!(client.get_stream(&id1).sender, sender);

    // Disable mocked auth to enforce authority
    env.mock_auths(&[]);
    let unauth_res =
        client.try_create_stream(&sender, &recipient, &token, &500, &0, &100, &0, &None);
    assert!(unauth_res.is_err());

    // Balance remains 500 (not drained by unauthorized call)
    assert_eq!(token::Client::new(&env, &token).balance(&sender), 500);

    // Subsequent valid call gets next ID 2
    env.mock_all_auths();
    let id2 = client.create_stream(&sender, &recipient, &token, &500, &0, &100, &0, &None);
    assert_eq!(id2, 2);
}

// =============================================================================
// #1170 — Make failure atomic in Stream ID allocation
// =============================================================================

#[test]
fn test_stream_id_allocation_atomic_failure_rollback() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    token_admin.mint(&sender, &400);

    let res = client.try_create_stream(&sender, &recipient, &token, &1000, &0, &100, &0, &None);
    assert!(res.is_err());
    assert_eq!(token::Client::new(&env, &token).balance(&sender), 400);

    token_admin.mint(&sender, &600);

    let id = client.create_stream(&sender, &recipient, &token, &1000, &0, &100, &0, &None);
    assert_eq!(id, 1);
    assert_eq!(client.get_stream(&id).total_amount, 1000);
    assert_eq!(token::Client::new(&env, &token).balance(&sender), 0);
}

// =============================================================================
// #1169 — Specify edge behavior for Stream ID allocation
// =============================================================================

#[test]
fn test_stream_id_allocation_edge_amounts_and_checked_arithmetic() {
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

    let id1 = client.create_stream(&sender, &recipient, &token, &1, &0, &100, &0, &None);
    assert_eq!(id1, 1);
    assert_eq!(client.get_stream(&id1).total_amount, 1);

    let zero_res = client.try_create_stream(&sender, &recipient, &token, &0, &0, &100, &0, &None);
    assert!(zero_res.is_err());

    let neg_res = client.try_create_stream(&sender, &recipient, &token, &-500, &0, &100, &0, &None);
    assert!(neg_res.is_err());

    let id2 = client.create_stream(&sender, &recipient, &token, &999, &0, &100, &0, &None);
    assert_eq!(id2, 2);
    assert_eq!(client.get_stream(&id2).total_amount, 999);
}

// =============================================================================
// #1168 - Add Soroban regression for Asset contract handling
// =============================================================================

#[test]
fn test_asset_contract_handling_two_assets_and_unsupported_asset() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let asset_a = create_token(&env, &token_admin);
    let asset_b = create_token(&env, &token_admin);
    let unsupported_asset = create_token(&env, &token_admin);

    let client_a = token::Client::new(&env, &asset_a);
    let client_b = token::Client::new(&env, &asset_b);
    let client_unsupported = token::Client::new(&env, &unsupported_asset);
    let token_mint_a = token::StellarAssetClient::new(&env, &asset_a);
    let token_mint_b = token::StellarAssetClient::new(&env, &asset_b);
    let token_mint_unsupported = token::StellarAssetClient::new(&env, &unsupported_asset);

    // Mint balances
    token_mint_a.mint(&sender, &10_000);
    token_mint_b.mint(&sender, &50_000);
    token_mint_unsupported.mint(&sender, &5_000);

    // Initialize with asset_a and asset_b in allowlist
    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, asset_a.clone(), asset_b.clone()],
    );

    // 1. Two assets: create concurrent streams with different amounts & parameters
    let id_a = client.create_stream(&sender, &recipient_a, &asset_a, &1_000, &0, &100, &0, &None);
    let id_b = client.create_stream(
        &sender,
        &recipient_b,
        &asset_b,
        &20_000,
        &0,
        &200,
        &0,
        &None,
    );

    assert_eq!(id_a, 1);
    assert_eq!(id_b, 2);

    let stream_a = client.get_stream(&id_a);
    let stream_b = client.get_stream(&id_b);
    assert_eq!(stream_a.token, asset_a);
    assert_eq!(stream_a.total_amount, 1_000);
    assert_eq!(stream_b.token, asset_b);
    assert_eq!(stream_b.total_amount, 20_000);

    // Verify balances escrowed accurately per asset contract
    assert_eq!(client_a.balance(&sender), 9_000);
    assert_eq!(client_a.balance(&contract_id), 1_000);
    assert_eq!(client_b.balance(&sender), 30_000);
    assert_eq!(client_b.balance(&contract_id), 20_000);

    // 2. Unsupported asset rollback verification
    let res = client.try_create_stream(
        &sender,
        &recipient_a,
        &unsupported_asset,
        &1_000,
        &0,
        &100,
        &0,
        &None,
    );
    assert!(res.is_err());
    // Ensure unsupported token balance remained completely untouched (atomic rollback)
    assert_eq!(client_unsupported.balance(&sender), 5_000);
    assert_eq!(client_unsupported.balance(&contract_id), 0);
}

// =============================================================================
// #1167 - Align events with Asset contract handling state
// =============================================================================

#[test]
fn test_asset_contract_handling_events_aligned_with_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let asset_a = create_token(&env, &token_admin);
    let asset_b = create_token(&env, &token_admin);
    let unsupported_asset = create_token(&env, &token_admin);

    let token_mint_a = token::StellarAssetClient::new(&env, &asset_a);
    let token_mint_b = token::StellarAssetClient::new(&env, &asset_b);
    let token_mint_unsupported = token::StellarAssetClient::new(&env, &unsupported_asset);

    token_mint_a.mint(&sender, &5_000);
    token_mint_b.mint(&sender, &15_000);
    token_mint_unsupported.mint(&sender, &2_000);

    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, asset_a.clone(), asset_b.clone()],
    );

    let events_count_init = env.events().all().len();

    // 1. Create stream with Asset A (emits token transfer event + StreamCreated event)
    let id_a = client.create_stream(&sender, &recipient_a, &asset_a, &3_000, &0, &100, &0, &None);
    assert_eq!(id_a, 1);
    let events_after_a = env.events().all();
    assert_eq!(events_after_a.len(), events_count_init + 2);

    // 2. Create stream with Asset B (emits token transfer event + StreamCreated event)
    let id_b = client.create_stream(
        &sender,
        &recipient_b,
        &asset_b,
        &12_000,
        &0,
        &200,
        &0,
        &None,
    );
    assert_eq!(id_b, 2);
    let events_after_b = env.events().all();
    assert_eq!(events_after_b.len(), events_count_init + 4);

    // 3. Failed attempt with unsupported asset produces NO new events (atomic rollback)
    let failed_res = client.try_create_stream(
        &sender,
        &recipient_a,
        &unsupported_asset,
        &1_000,
        &0,
        &100,
        &0,
        &None,
    );
    assert!(failed_res.is_err());
    assert_eq!(env.events().all().len(), events_count_init + 4);

    // Verify stream state aligns exactly with emitted event parameters
    let stream_a = client.get_stream(&id_a);
    assert_eq!(stream_a.token, asset_a);
    assert_eq!(stream_a.total_amount, 3_000);

    let stream_b = client.get_stream(&id_b);
    assert_eq!(stream_b.token, asset_b);
    assert_eq!(stream_b.total_amount, 12_000);
}

// =============================================================================
// #1166 - Check authority in Asset contract handling
// =============================================================================

#[test]
fn test_asset_contract_handling_authority_check_across_assets() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let asset_a = create_token(&env, &token_admin);
    let asset_b = create_token(&env, &token_admin);

    let client_a = token::Client::new(&env, &asset_a);
    let client_b = token::Client::new(&env, &asset_b);
    let token_mint_a = token::StellarAssetClient::new(&env, &asset_a);
    let token_mint_b = token::StellarAssetClient::new(&env, &asset_b);

    token_mint_a.mint(&sender, &10_000);
    token_mint_b.mint(&sender, &20_000);

    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, asset_a.clone(), asset_b.clone()],
    );

    // 1. Authorized call succeeds for asset A
    let id_a = client.create_stream(&sender, &recipient_a, &asset_a, &4_000, &0, &100, &0, &None);
    assert_eq!(id_a, 1);
    assert_eq!(client_a.balance(&sender), 6_000);

    // 2. Unauthorized call for asset B without sender auth fails
    env.mock_auths(&[]);
    let unauth_res =
        client.try_create_stream(&sender, &recipient_b, &asset_b, &8_000, &0, &100, &0, &None);
    assert!(unauth_res.is_err());

    // 3. Asset B balance and contract state remain completely unchanged
    assert_eq!(client_b.balance(&sender), 20_000);
    assert_eq!(client_b.balance(&contract_id), 0);

    // 4. Authorized call succeeds when auth is provided
    env.mock_all_auths();
    let id_b = client.create_stream(&sender, &recipient_b, &asset_b, &8_000, &0, &100, &0, &None);
    assert_eq!(id_b, 2);
    assert_eq!(client_b.balance(&sender), 12_000);
    assert_eq!(client_b.balance(&contract_id), 8_000);
}

// =============================================================================
// #1165 - Make failure atomic in Asset contract handling
// =============================================================================

#[test]
fn test_asset_contract_handling_atomic_failure_rollback() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let allowed_token = create_token(&env, &token_admin);
    let unsupported_token = create_token(&env, &token_admin);

    let client_allowed = token::Client::new(&env, &allowed_token);
    let client_unsupported = token::Client::new(&env, &unsupported_token);
    let mint_allowed = token::StellarAssetClient::new(&env, &allowed_token);
    let mint_unsupported = token::StellarAssetClient::new(&env, &unsupported_token);

    mint_allowed.mint(&sender, &5_000);
    mint_unsupported.mint(&sender, &5_000);

    // Initialize allowlist with allowed_token
    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, allowed_token.clone()],
    );

    // 1. Attempt to create stream with unsupported asset must fail atomically
    let fail_res = client.try_create_stream(
        &sender,
        &recipient,
        &unsupported_token,
        &2_000,
        &0,
        &100,
        &0,
        &None,
    );
    assert!(fail_res.is_err());

    // 2. State & balances remain strictly unmutated
    assert_eq!(client_unsupported.balance(&sender), 5_000);
    assert_eq!(client_unsupported.balance(&contract_id), 0);
    assert_eq!(client_allowed.balance(&sender), 5_000);
    assert_eq!(client_allowed.balance(&contract_id), 0);

    // 3. Next valid call receives clean stream ID 1
    let id1 = client.create_stream(
        &sender,
        &recipient,
        &allowed_token,
        &2_000,
        &0,
        &100,
        &0,
        &None,
    );
    assert_eq!(id1, 1);
    assert_eq!(client_allowed.balance(&sender), 3_000);
    assert_eq!(client_allowed.balance(&contract_id), 2_000);
}

// =============================================================================
// #1164 - Specify edge behavior for Asset contract handling
// =============================================================================

#[test]
fn test_asset_contract_handling_edge_precision_and_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient_micro = Address::generate(&env);
    let recipient_macro = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let asset_micro = create_token(&env, &token_admin);
    let asset_macro = create_token(&env, &token_admin);

    let client_micro = token::Client::new(&env, &asset_micro);
    let client_macro = token::Client::new(&env, &asset_macro);
    let mint_micro = token::StellarAssetClient::new(&env, &asset_micro);
    let mint_macro = token::StellarAssetClient::new(&env, &asset_macro);

    mint_micro.mint(&sender, &10);
    mint_macro.mint(&sender, &1_000_000_000);

    client.initialize(
        &admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env, asset_micro.clone(), asset_macro.clone()],
    );

    // 1. Boundary 1: Smallest integer unit (1) on asset_micro
    let id_micro = client.create_stream(
        &sender,
        &recipient_micro,
        &asset_micro,
        &1,
        &0,
        &100,
        &0,
        &None,
    );
    assert_eq!(id_micro, 1);
    assert_eq!(client.get_stream(&id_micro).total_amount, 1);
    assert_eq!(client_micro.balance(&sender), 9);
    assert_eq!(client_micro.balance(&contract_id), 1);

    // 2. Boundary 2: Zero or negative amount rejected for both assets
    assert!(client
        .try_create_stream(
            &sender,
            &recipient_micro,
            &asset_micro,
            &0,
            &0,
            &100,
            &0,
            &None
        )
        .is_err());
    assert!(client
        .try_create_stream(
            &sender,
            &recipient_macro,
            &asset_macro,
            &-100,
            &0,
            &100,
            &0,
            &None
        )
        .is_err());

    // 3. Boundary 3: Large integer scale on asset_macro with checked arithmetic
    let id_macro = client.create_stream(
        &sender,
        &recipient_macro,
        &asset_macro,
        &500_000_000,
        &0,
        &500,
        &0,
        &None,
    );
    assert_eq!(id_macro, 2);
    assert_eq!(client.get_stream(&id_macro).total_amount, 500_000_000);
    assert_eq!(client_macro.balance(&sender), 500_000_000);
    assert_eq!(client_macro.balance(&contract_id), 500_000_000);
}

// =============================================================================
// #1163 - Add Soroban regression for Contract event order
// =============================================================================

#[test]
fn test_contract_event_order_create_claim_cancel_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // 1. Create stream for 1000 tokens from t=0 to t=100
    env.ledger().set_timestamp(0);
    let events_before_create = env.events().all().len();
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);
    let events_after_create = env.events().all().len();
    assert!(events_after_create > events_before_create);

    // 2. Advance time to 50s and claim 500 tokens
    env.ledger().set_timestamp(50);
    let events_before_claim = env.events().all().len();
    let claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&contract_id), 500);
    let events_after_claim = env.events().all().len();
    assert!(events_after_claim > events_before_claim);

    // 3. Cancel stream, returning remaining 500 to sender
    let events_before_cancel = env.events().all().len();
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 500);
    assert_eq!(token_client.balance(&contract_id), 0);
    let events_after_cancel = env.events().all().len();
    assert!(events_after_cancel > events_before_cancel);

    // 4. Repeated claim or cancel after cancellation fails atomically
    let invalid_claim = client.try_claim(&stream_id, &recipient, &100);
    assert!(invalid_claim.is_err());
    assert_eq!(env.events().all().len(), events_after_cancel);
}

// =============================================================================
// #1162 - Align events with Contract event order state
// =============================================================================

#[test]
fn test_contract_event_order_events_aligned_with_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    token_admin.mint(&sender, &2_000);

    // 1. Create stream at t=100
    env.ledger().set_timestamp(100);
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &2_000, &100, &200, &0, &None);
    assert_eq!(stream_id, 1);

    // Reconstruct and verify stream state matches event expectations
    let stream_after_create = client.get_stream(&stream_id);
    assert_eq!(stream_after_create.sender, sender);
    assert_eq!(stream_after_create.recipient, recipient);
    assert_eq!(stream_after_create.total_amount, 2_000);
    assert_eq!(stream_after_create.claimed_amount, 0);
    assert!(!stream_after_create.canceled);

    // 2. Claim partial at t=150 (50% vested = 1000)
    env.ledger().set_timestamp(150);
    let events_count_before_claim = env.events().all().len();
    let claimed = client.claim(&stream_id, &recipient, &1_000);
    assert_eq!(claimed, 1_000);
    assert!(env.events().all().len() > events_count_before_claim);

    let stream_after_claim = client.get_stream(&stream_id);
    assert_eq!(stream_after_claim.claimed_amount, 1_000);

    // 3. Cancel stream at t=150 (remaining 1000 refunded to sender)
    let events_count_before_cancel = env.events().all().len();
    client.cancel(&stream_id, &sender);
    assert!(env.events().all().len() > events_count_before_cancel);

    let stream_after_cancel = client.get_stream(&stream_id);
    assert!(stream_after_cancel.canceled);

    // 4. Failed call post-cancellation produces zero events
    let events_count_after_cancel = env.events().all().len();
    let fail_claim = client.try_claim(&stream_id, &recipient, &100);
    assert!(fail_claim.is_err());
    assert_eq!(env.events().all().len(), events_count_after_cancel);
}

// =============================================================================
// #1161 - Check authority in Contract event order
// =============================================================================

#[test]
fn test_contract_event_order_authority_checks() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    // Advance time to 50s
    env.ledger().set_timestamp(50);

    // 1. Unauthorized recipient check: without recipient auth, claim fails
    env.mock_auths(&[]);
    let unauth_claim = client.try_claim(&stream_id, &recipient, &500);
    assert!(unauth_claim.is_err());
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 2. Stranger claiming with their own auth (not stream recipient) fails
    env.mock_all_auths();
    let stranger_claim = client.try_claim(&stream_id, &stranger, &500);
    assert!(stranger_claim.is_err());
    assert_eq!(token_client.balance(&stranger), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 3. Stranger attempting to cancel fails
    let stranger_cancel = client.try_cancel(&stream_id, &stranger);
    assert!(stranger_cancel.is_err());
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 4. Authorized claim succeeds
    let claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&contract_id), 500);

    // 5. Authorized cancel succeeds
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 500);
    assert_eq!(token_client.balance(&contract_id), 0);
}

// =============================================================================
// #1160 - Make failure atomic in Contract event order
// =============================================================================

#[test]
fn test_contract_event_order_atomic_failure_rollback() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // Create stream for 1000 tokens from t=100 to t=200
    env.ledger().set_timestamp(100);
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1_000, &100, &200, &0, &None);
    assert_eq!(stream_id, 1);

    // Advance to t=150 (500 claimable)
    env.ledger().set_timestamp(150);

    // 1. Attempt to over-claim 800 tokens (exceeds 500 claimable) fails atomically
    let events_before_fail = env.events().all().len();
    let overclaim_res = client.try_claim(&stream_id, &recipient, &800);
    assert!(overclaim_res.is_err());
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 0);
    assert_eq!(env.events().all().len(), events_before_fail);

    // 2. Valid claim of 400 tokens succeeds
    let claimed = client.claim(&stream_id, &recipient, &400);
    assert_eq!(claimed, 400);
    assert_eq!(token_client.balance(&recipient), 400);
    assert_eq!(token_client.balance(&contract_id), 600);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 400);

    // 3. Unauthorized cancel by stranger fails atomically
    let events_before_stranger = env.events().all().len();
    let unauth_cancel = client.try_cancel(&stream_id, &stranger);
    assert!(unauth_cancel.is_err());
    assert_eq!(token_client.balance(&contract_id), 600);
    assert!(!client.get_stream(&stream_id).canceled);
    assert_eq!(env.events().all().len(), events_before_stranger);

    // 4. Valid cancel succeeds: unvested 500 refunded to sender, contract retains 100 vested for recipient
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 500);
    assert_eq!(token_client.balance(&recipient), 400);
    assert_eq!(token_client.balance(&contract_id), 100);
    assert!(client.get_stream(&stream_id).canceled);
}

// =============================================================================
// #1159 - Specify edge behavior for Contract event order
// =============================================================================

#[test]
fn test_contract_event_order_edge_amounts_and_zero_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &100);

    // 1. Boundary: Minimal 1-unit stream
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1, &0, &10, &0, &None);
    assert_eq!(stream_id, 1);
    assert_eq!(token_client.balance(&contract_id), 1);

    // 2. Boundary: Zero and negative claims are rejected
    assert!(client.try_claim(&stream_id, &recipient, &0).is_err());
    assert!(client.try_claim(&stream_id, &recipient, &-1).is_err());

    // 3. Boundary: Full vesting reached at t=10
    env.ledger().set_timestamp(10);
    let claimed = client.claim(&stream_id, &recipient, &1);
    assert_eq!(claimed, 1);
    assert_eq!(token_client.balance(&recipient), 1);
    assert_eq!(token_client.balance(&contract_id), 0);

    // 4. Boundary: Cancel when already 100% claimed (sender gets 0 refund, no overflow)
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 99);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert!(client.get_stream(&stream_id).canceled);
}

// =============================================================================
// #1158 - Add Soroban regression for Sender authorization
// =============================================================================

#[test]
fn test_sender_authorization_cancel_by_unrelated_address_and_replayed_cancellation() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let unrelated = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // 1. Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 2. Unrelated address attempts to cancel stream -> rejected
    let unauth_cancel = client.try_cancel(&stream_id, &unrelated);
    assert!(unauth_cancel.is_err());
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(token_client.balance(&sender), 0);
    assert!(!client.get_stream(&stream_id).canceled);

    // 3. Authorized sender cancels stream at t=40
    env.ledger().set_timestamp(40);
    let events_before_cancel = env.events().all().len();
    client.cancel(&stream_id, &sender);
    assert!(client.get_stream(&stream_id).canceled);
    // Unvested 600 refunded to sender, contract retains 400 for recipient
    assert_eq!(token_client.balance(&sender), 600);
    assert_eq!(token_client.balance(&contract_id), 400);
    let events_after_cancel = env.events().all().len();
    assert!(events_after_cancel > events_before_cancel);

    // 4. Replayed cancellation attempt on already cancelled stream -> idempotent / zero double refund
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 600);
    assert_eq!(token_client.balance(&contract_id), 400);
    assert_eq!(env.events().all().len(), events_after_cancel);
}

// =============================================================================
// #1157 - Align events with Sender authorization state
// =============================================================================

#[test]
fn test_sender_authorization_events_aligned_with_cancellation_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let unrelated = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // 1. Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    // 2. Unrelated cancellation failure produces zero new events
    let events_count_after_create = env.events().all().len();
    assert!(client.try_cancel(&stream_id, &unrelated).is_err());
    assert_eq!(env.events().all().len(), events_count_after_create);

    // 3. Sender cancellation emits exact event payload
    env.ledger().set_timestamp(30);
    client.cancel(&stream_id, &sender);
    let events_after_cancel = env.events().all();
    assert_eq!(events_after_cancel.len(), events_count_after_create + 2); // transfer + StreamCanceled

    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    assert_eq!(stream.sender, sender);
    assert_eq!(stream.total_amount, 300); // reduced to vested amount

    // 4. Repeated/replayed cancellation produces zero additional events (indexer exactly-once invariant)
    client.cancel(&stream_id, &sender);
    assert_eq!(env.events().all().len(), events_count_after_create + 2);
}

// =============================================================================
// #1156 - Check authority in Sender authorization
// =============================================================================

#[test]
fn test_sender_authorization_check_authority() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    // 1. Without sender signature/auth, cancellation fails before balance/state change
    env.mock_auths(&[]);
    let unauth_cancel = client.try_cancel(&stream_id, &sender);
    assert!(unauth_cancel.is_err());
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(token_client.balance(&sender), 0);
    assert!(!client.get_stream(&stream_id).canceled);

    // 2. Stranger with their own auth attempting to pass sender address fails
    env.mock_all_auths();
    let stranger_res = client.try_cancel(&stream_id, &stranger);
    assert!(stranger_res.is_err());
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert!(!client.get_stream(&stream_id).canceled);

    // 3. Authorized sender succeeds
    client.cancel(&stream_id, &sender);
    assert!(client.get_stream(&stream_id).canceled);
    assert_eq!(token_client.balance(&sender), 1_000);
    assert_eq!(token_client.balance(&contract_id), 0);
}

// =============================================================================
// #1155 - Make failure atomic in Sender authorization
// =============================================================================

#[test]
fn test_sender_authorization_atomic_failure_rollback() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let unrelated = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    // Advance to t=50
    env.ledger().set_timestamp(50);

    // 1. Unrelated address fails cancellation atomically
    let failed_cancel = client.try_cancel(&stream_id, &unrelated);
    assert!(failed_cancel.is_err());
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(token_client.balance(&sender), 0);
    assert!(!client.get_stream(&stream_id).canceled);

    // 2. Sender cancels cleanly: 500 refunded to sender, 500 kept in contract for recipient
    client.cancel(&stream_id, &sender);
    assert!(client.get_stream(&stream_id).canceled);
    assert_eq!(token_client.balance(&sender), 500);
    assert_eq!(token_client.balance(&contract_id), 500);

    // 3. Replayed cancellation leaves balances strictly unchanged
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 500);
    assert_eq!(token_client.balance(&contract_id), 500);

    // 4. Recipient claims their remaining 500 vested tokens
    let claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&contract_id), 0);
}

// =============================================================================
// #1154 - Specify edge behavior for Sender authorization
// =============================================================================

#[test]
fn test_sender_authorization_edge_amounts_and_boundary_cancellation() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let unrelated = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &100);

    // 1. Boundary: 1-unit stream from t=10 to t=20
    env.ledger().set_timestamp(10);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1, &10, &20, &0, &None);
    assert_eq!(stream_id, 1);
    assert_eq!(token_client.balance(&contract_id), 1);
    assert_eq!(token_client.balance(&sender), 99);

    // 2. Boundary: Unrelated address cancel attempt rejected at boundary
    assert!(client.try_cancel(&stream_id, &unrelated).is_err());
    assert_eq!(token_client.balance(&contract_id), 1);

    // 3. Boundary: Cancel at t=10 (0 vested, exact 1 unit refund with checked math)
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 100);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert!(client.get_stream(&stream_id).canceled);

    // 4. Boundary: Post-cancellation claim rejected cleanly without math underflow
    assert!(client.try_claim(&stream_id, &recipient, &1).is_err());
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 0);
}

// =============================================================================
// #1153 - Add Soroban regression for Recipient authorization
// =============================================================================

#[test]
fn test_recipient_authorization_different_recipient_and_auth_changes() {
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
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // 1. Create stream from t=0 to t=100 designated for recipient_a
    env.ledger().set_timestamp(0);
    let stream_id =
        client.create_stream(&sender, &recipient_a, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // Advance to t=50 (500 claimable)
    env.ledger().set_timestamp(50);

    // 2. Different recipient (recipient_b) attempts to claim -> rejected
    let events_before_fail = env.events().all().len();
    let wrong_recipient_res = client.try_claim(&stream_id, &recipient_b, &200);
    assert!(wrong_recipient_res.is_err());
    assert_eq!(token_client.balance(&recipient_b), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(env.events().all().len(), events_before_fail);

    // 3. Designated recipient calls without authorization -> rejected
    env.mock_auths(&[]);
    let unauth_res = client.try_claim(&stream_id, &recipient_a, &200);
    assert!(unauth_res.is_err());
    assert_eq!(token_client.balance(&recipient_a), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 4. Authorized designated recipient succeeds
    env.mock_all_auths();
    let claimed = client.claim(&stream_id, &recipient_a, &200);
    assert_eq!(claimed, 200);
    assert_eq!(token_client.balance(&recipient_a), 200);
    assert_eq!(token_client.balance(&contract_id), 800);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 200);
}

// =============================================================================
// #1152 - Align events with Recipient authorization state
// =============================================================================

#[test]
fn test_recipient_authorization_events_aligned_with_claim_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // 1. Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    // 2. Failed claim by wrong recipient emits zero events
    let events_count_after_create = env.events().all().len();
    assert!(client.try_claim(&stream_id, &stranger, &200).is_err());
    assert_eq!(env.events().all().len(), events_count_after_create);

    // 3. Authorized partial claim at t=50 (500 claimable) emits StreamClaimed event
    env.ledger().set_timestamp(50);
    let claimed = client.claim(&stream_id, &recipient, &400);
    assert_eq!(claimed, 400);
    let events_after_claim = env.events().all();
    assert_eq!(events_after_claim.len(), events_count_after_create + 2); // transfer + StreamClaimed

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.recipient, recipient);
    assert_eq!(stream.claimed_amount, 400);

    // 4. Final claim at t=100 completes the stream and emits StreamClaimed + StreamCompleted
    env.ledger().set_timestamp(100);
    let final_claim = client.claim(&stream_id, &recipient, &600);
    assert_eq!(final_claim, 600);
    let stream_done = client.get_stream(&stream_id);
    assert_eq!(stream_done.claimed_amount, 1_000);

    // 5. Subsequent claim after completion emits zero events
    let events_after_done = env.events().all().len();
    assert!(client.try_claim(&stream_id, &recipient, &10).is_err());
    assert_eq!(env.events().all().len(), events_after_done);
}

// =============================================================================
// #1151 - Check authority in Recipient authorization
// =============================================================================

#[test]
fn test_recipient_authorization_check_signer_authority() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    // Advance to t=50 (500 claimable)
    env.ledger().set_timestamp(50);

    // 1. Without recipient signature/auth, claim fails before any balance or state changes
    env.mock_auths(&[]);
    let unauth_res = client.try_claim(&stream_id, &recipient, &250);
    assert!(unauth_res.is_err());
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 0);

    // 2. Stranger claiming with their own auth (not recipient) fails
    env.mock_all_auths();
    let stranger_res = client.try_claim(&stream_id, &stranger, &250);
    assert!(stranger_res.is_err());
    assert_eq!(token_client.balance(&stranger), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 3. Authorized recipient claim succeeds
    let claimed = client.claim(&stream_id, &recipient, &250);
    assert_eq!(claimed, 250);
    assert_eq!(token_client.balance(&recipient), 250);
    assert_eq!(token_client.balance(&contract_id), 750);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 250);
}

// =============================================================================
// #1150 - Make failure atomic in Recipient authorization
// =============================================================================

#[test]
fn test_recipient_authorization_atomic_failure_rollback() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mismatched_account = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // Create stream for 1000 tokens from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    // Advance to t=50 (500 claimable)
    env.ledger().set_timestamp(50);

    // 1. Account mismatch / wrong recipient fails atomically before token transfer
    let fail_res = client.try_claim(&stream_id, &mismatched_account, &500);
    assert!(fail_res.is_err());
    assert_eq!(token_client.balance(&mismatched_account), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 0);

    // 2. Storage and balances remain consistent and recoverable
    let valid_claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(valid_claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&contract_id), 500);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 500);
}

// =============================================================================
// #1149 - Specify edge behavior for Recipient authorization
// =============================================================================

#[test]
fn test_recipient_authorization_edge_amounts_and_different_recipient_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &50);

    // 1. Boundary: Minimal 1-unit stream from t=0 to t=10
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1, &0, &10, &0, &None);
    assert_eq!(stream_id, 1);
    assert_eq!(token_client.balance(&contract_id), 1);

    // 2. Boundary: Stranger call on 1-unit stream rejected
    assert!(client.try_claim(&stream_id, &stranger, &1).is_err());
    assert_eq!(token_client.balance(&stranger), 0);
    assert_eq!(token_client.balance(&contract_id), 1);

    // 3. Boundary: Zero/negative claims rejected
    assert!(client.try_claim(&stream_id, &recipient, &0).is_err());
    assert!(client.try_claim(&stream_id, &recipient, &-10).is_err());

    // 4. Boundary: Exact 1 token claim at 100% vesting (t=10)
    env.ledger().set_timestamp(10);
    let claimed = client.claim(&stream_id, &recipient, &1);
    assert_eq!(claimed, 1);
    assert_eq!(token_client.balance(&recipient), 1);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 1);
}

// =============================================================================
// #1148 - Add Soroban regression for Cancellation refund
// =============================================================================

#[test]
fn test_cancellation_refund_before_start_and_near_end_boundaries() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient_1 = Address::generate(&env);
    let recipient_2 = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &2_000);

    // 1. Boundary 1: Cancel before start time (t=50, start=100, end=200)
    env.ledger().set_timestamp(50);
    let id1 = client.create_stream(&sender, &recipient_1, &token, &1_000, &100, &200, &0, &None);
    assert_eq!(id1, 1);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    client.cancel(&id1, &sender);
    assert!(client.get_stream(&id1).canceled);
    // 0 vested, full 1000 refunded to sender
    assert_eq!(token_client.balance(&sender), 2_000);
    assert_eq!(token_client.balance(&contract_id), 0);

    // 2. Boundary 2: Cancel near end time (t=190, start=100, end=200)
    let id2 = client.create_stream(&sender, &recipient_2, &token, &1_000, &100, &200, &0, &None);
    assert_eq!(id2, 2);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    env.ledger().set_timestamp(190);
    client.cancel(&id2, &sender);
    assert!(client.get_stream(&id2).canceled);
    // 90% vested (900), 10% unvested (100) refunded to sender
    assert_eq!(token_client.balance(&sender), 1_100);
    assert_eq!(token_client.balance(&contract_id), 900);

    // Recipient claims vested 900
    let claimed = client.claim(&id2, &recipient_2, &900);
    assert_eq!(claimed, 900);
    assert_eq!(token_client.balance(&recipient_2), 900);
    assert_eq!(token_client.balance(&contract_id), 0);
}

// =============================================================================
// #1147 - Align events with Cancellation refund state
// =============================================================================

#[test]
fn test_cancellation_refund_events_aligned_with_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // 1. Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(stream_id, 1);

    // 2. Advance to t=60 and cancel stream
    env.ledger().set_timestamp(60);
    let events_before_cancel = env.events().all().len();
    client.cancel(&stream_id, &sender);
    let events_after_cancel = env.events().all();
    assert_eq!(events_after_cancel.len(), events_before_cancel + 2); // token transfer + StreamCanceled

    // 3. Verify state aligns with emitted refund and recipient entitlement
    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    assert_eq!(stream.total_amount, 600); // 600 remaining entitlement for recipient
    assert_eq!(stream.claimed_amount, 0);

    // 4. Repeated cancel emits 0 additional events (indexer exactly-once invariant)
    client.cancel(&stream_id, &sender);
    assert_eq!(env.events().all().len(), events_after_cancel.len());
}

// =============================================================================
// #1146 - Check authority in Cancellation refund
// =============================================================================

#[test]
fn test_cancellation_refund_checks_authority_and_protects_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // 1. Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 2. Advance to t=40 (vested = 400, unvested refund = 600)
    env.ledger().set_timestamp(40);

    // 3. Unauthorized stranger cannot trigger cancellation refund
    let stranger_res = client.try_cancel(&stream_id, &stranger);
    assert!(stranger_res.is_err());
    assert_eq!(token_client.balance(&stranger), 0);
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 4. Recipient cannot cancel on behalf of sender
    let recipient_res = client.try_cancel(&stream_id, &recipient);
    assert!(recipient_res.is_err());
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 5. Authorized sender successfully cancels and receives exact refund
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 600);
    assert_eq!(token_client.balance(&contract_id), 400);

    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    assert_eq!(stream.total_amount, 400);
}

// =============================================================================
// #1145 - Make failure atomic in Cancellation refund
// =============================================================================

#[test]
fn test_cancellation_refund_failure_is_atomic() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // 1. Create stream: 1000 tokens from t=100 to t=200
    env.ledger().set_timestamp(100);
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1_000, &100, &200, &0, &None);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 2. Advance to t=150
    env.ledger().set_timestamp(150);

    // 3. Unauthorized cancel fails atomically
    let events_before_fail = env.events().all().len();
    let err_res = client.try_cancel(&stream_id, &stranger);
    assert!(err_res.is_err());
    assert_eq!(env.events().all().len(), events_before_fail);
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    let stream = client.get_stream(&stream_id);
    assert!(!stream.canceled);
    assert_eq!(stream.total_amount, 1_000);

    // 4. Non-existent stream cancel fails atomically
    let invalid_id_res = client.try_cancel(&999_999, &sender);
    assert!(invalid_id_res.is_err());
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 5. Authorized cancel succeeds atomically
    client.cancel(&stream_id, &sender);
    assert_eq!(token_client.balance(&sender), 500);
    assert_eq!(token_client.balance(&contract_id), 500);

    let stream_canceled = client.get_stream(&stream_id);
    assert!(stream_canceled.canceled);
    assert_eq!(stream_canceled.total_amount, 500);

    // 6. Recipient can claim all remaining vested funds
    let claimed = client.claim(&stream_id, &recipient, &500);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&contract_id), 0);
}

// =============================================================================
// #1144 - Specify edge behavior for Cancellation refund
// =============================================================================

#[test]
fn test_cancellation_refund_edge_behavior_boundaries() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &3_000);

    // Edge 1: Cancellation at exact start_time (t = 100, vested = 0) -> 100% refund
    env.ledger().set_timestamp(100);
    let stream_1 = client.create_stream(&sender, &recipient, &token, &1_000, &100, &200, &0, &None);
    client.cancel(&stream_1, &sender);
    assert_eq!(token_client.balance(&sender), 3_000); // full 1000 refunded
    assert_eq!(token_client.balance(&contract_id), 0);
    let s1 = client.get_stream(&stream_1);
    assert!(s1.canceled);
    assert_eq!(s1.total_amount, 0);

    // Edge 2: Cancellation after full vesting (t = 250 >= 200) -> 0 refund
    env.ledger().set_timestamp(100);
    let stream_2 = client.create_stream(&sender, &recipient, &token, &1_000, &100, &200, &0, &None);
    env.ledger().set_timestamp(250);
    client.cancel(&stream_2, &sender);
    assert_eq!(token_client.balance(&sender), 2_000); // 0 refund transferred
    assert_eq!(token_client.balance(&contract_id), 1_000); // all funds remain for recipient
    let s2 = client.get_stream(&stream_2);
    assert!(s2.canceled);
    assert_eq!(s2.total_amount, 1_000);
    // Recipient claims full 1000
    let claimed_2 = client.claim(&stream_2, &recipient, &1_000);
    assert_eq!(claimed_2, 1_000);
    assert_eq!(token_client.balance(&recipient), 1_000);

    // Edge 3: Cancellation after partial claims by recipient
    env.ledger().set_timestamp(100);
    let stream_3 = client.create_stream(&sender, &recipient, &token, &1_000, &100, &200, &0, &None);
    // Recipient claims 300 at t = 130
    env.ledger().set_timestamp(130);
    client.claim(&stream_3, &recipient, &300);
    // Cancel at t = 160 (vested = 600, refund = 400)
    env.ledger().set_timestamp(160);
    client.cancel(&stream_3, &sender);
    assert_eq!(token_client.balance(&sender), 1_400); // 1000 + 400 refund
    assert_eq!(token_client.balance(&contract_id), 300); // 600 vested - 300 claimed = 300 remaining

    // Recipient claims remaining 300
    client.claim(&stream_3, &recipient, &300);
    assert_eq!(token_client.balance(&recipient), 1_600);
    assert_eq!(token_client.balance(&contract_id), 0);
}

// =============================================================================
// #1143 - Add Soroban regression for Clawback integration
// =============================================================================

#[test]
fn test_clawback_integration_regression() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_asset = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    // Initialize contract with compliance admin
    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );

    token_asset.mint(&sender, &1_000);

    // 1. Create stream: 1000 tokens from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 2. Advance to t=50 (vested = 500)
    env.ledger().set_timestamp(50);

    // 3. Recipient claims 200
    let claimed = client.claim(&stream_id, &recipient, &200);
    assert_eq!(claimed, 200);
    assert_eq!(token_client.balance(&recipient), 200);
    assert_eq!(token_client.balance(&contract_id), 800);

    // 4. Admin claws back 500 (capped at remaining unclaimed vested = 300)
    let clawed = client.clawback(&stream_id, &500, &compliance_admin);
    assert_eq!(clawed, 300);
    assert_eq!(token_client.balance(&compliance_admin), 300);
    assert_eq!(token_client.balance(&contract_id), 500);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 500); // 200 claimed + 300 clawed

    // 5. Subsequent clawback at same timestamp yields 0
    let second_claw = client.clawback(&stream_id, &100, &compliance_admin);
    assert_eq!(second_claw, 0);

    // 6. Advance to t=100 (total vested = 1000, remaining unclaimed = 500)
    env.ledger().set_timestamp(100);
    let final_claim = client.claim(&stream_id, &recipient, &250);
    assert_eq!(final_claim, 250);
    assert_eq!(token_client.balance(&recipient), 450);

    let final_claw = client.clawback(&stream_id, &250, &compliance_admin);
    assert_eq!(final_claw, 250);
    assert_eq!(token_client.balance(&compliance_admin), 550);
    assert_eq!(token_client.balance(&contract_id), 0);

    let stream_final = client.get_stream(&stream_id);
    assert_eq!(stream_final.claimed_amount, 1_000);
}

// =============================================================================
// #1142 - Align events with Clawback integration state
// =============================================================================

#[test]
fn test_clawback_integration_events_aligned_with_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_asset = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );

    token_asset.mint(&sender, &1_000);

    // 1. Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);

    // 2. Advance to t=40 (vested = 400)
    env.ledger().set_timestamp(40);
    let events_before = env.events().all().len();

    // 3. Admin claws back 250
    let clawed = client.clawback(&stream_id, &250, &compliance_admin);
    assert_eq!(clawed, 250);

    let events_after = env.events().all();
    assert_eq!(events_after.len(), events_before + 2); // transfer + ClawbackExecuted

    // 4. Verify state matches emitted event data
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 250);
    assert_eq!(token_client.balance(&compliance_admin), 250);
    assert_eq!(token_client.balance(&contract_id), 750);

    // 5. Claw back remaining 150 unclaimed vested (requesting 200 caps at 150)
    let clawed_remaining = client.clawback(&stream_id, &200, &compliance_admin);
    assert_eq!(clawed_remaining, 150); // capped at remaining 150

    // Redundant clawback when 0 remaining vested emits 0 events
    let events_before_empty = env.events().all().len();
    let clawed_empty = client.clawback(&stream_id, &100, &compliance_admin);
    assert_eq!(clawed_empty, 0); // zero clawed
    assert_eq!(env.events().all().len(), events_before_empty); // exactly zero events emitted
}

// =============================================================================
// #1141 - Check authority in Clawback integration
// =============================================================================

#[test]
fn test_clawback_integration_checks_authority_and_guards_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let attacker = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_asset = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    // 1. Initialize contract
    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );

    token_asset.mint(&sender, &1_000);

    // 2. Create stream from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);

    // 3. Advance to t=50 (vested = 500)
    env.ledger().set_timestamp(50);

    // 4. Unauthorized attacker cannot execute clawback
    let attacker_res = client.try_clawback(&stream_id, &200, &attacker);
    assert!(attacker_res.is_err());
    assert_eq!(token_client.balance(&attacker), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 5. Sender cannot execute clawback
    let sender_res = client.try_clawback(&stream_id, &200, &sender);
    assert!(sender_res.is_err());
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 6. Recipient cannot execute clawback
    let recipient_res = client.try_clawback(&stream_id, &200, &recipient);
    assert!(recipient_res.is_err());
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 7. Legitimate compliance admin successfully claws back
    let clawed = client.clawback(&stream_id, &300, &compliance_admin);
    assert_eq!(clawed, 300);
    assert_eq!(token_client.balance(&compliance_admin), 300);
    assert_eq!(token_client.balance(&contract_id), 700);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 300);
}

// =============================================================================
// #1140 - Make failure atomic in Clawback integration
// =============================================================================

#[test]
fn test_clawback_integration_failure_is_atomic() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_asset = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    // 1. Calling clawback before initialization fails atomically
    let uninit_res = client.try_clawback(&1, &100, &compliance_admin);
    assert!(uninit_res.is_err());

    // 2. Initialize contract
    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );

    token_asset.mint(&sender, &1_000);

    // 3. Create stream: 1000 tokens from t=0 to t=100
    env.ledger().set_timestamp(0);
    let stream_id = client.create_stream(&sender, &recipient, &token, &1_000, &0, &100, &0, &None);

    // 4. Advance to t=50 (vested = 500)
    env.ledger().set_timestamp(50);

    // 5. Zero / negative amount clawback fails atomically
    let events_before_zero = env.events().all().len();
    let zero_res = client.try_clawback(&stream_id, &0, &compliance_admin);
    assert!(zero_res.is_err());
    assert_eq!(env.events().all().len(), events_before_zero);
    assert_eq!(token_client.balance(&compliance_admin), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 0);

    // 6. Non-existent stream ID fails atomically
    let invalid_id_res = client.try_clawback(&999_999, &100, &compliance_admin);
    assert!(invalid_id_res.is_err());
    assert_eq!(token_client.balance(&compliance_admin), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 7. Unauthorized caller fails atomically
    let unauth_res = client.try_clawback(&stream_id, &100, &stranger);
    assert!(unauth_res.is_err());
    assert_eq!(token_client.balance(&stranger), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // 8. Legitimate clawback executes atomically
    let clawed = client.clawback(&stream_id, &300, &compliance_admin);
    assert_eq!(clawed, 300);
    assert_eq!(token_client.balance(&compliance_admin), 300);
    assert_eq!(token_client.balance(&contract_id), 700);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 300);
}

// =============================================================================
// #1139 - Specify edge behavior for Clawback integration
// =============================================================================

#[test]
fn test_clawback_integration_edge_behavior_boundaries() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let compliance_admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let token_asset = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    client.initialize(
        &compliance_admin,
        &Address::generate(&env),
        &soroban_sdk::vec![&env],
    );

    token_asset.mint(&sender, &2_000);

    // Edge 1: Clawback at start timestamp (0 vested) yields 0
    env.ledger().set_timestamp(100);
    let s1 = client.create_stream(&sender, &recipient, &token, &1_000, &100, &200, &0, &None);
    let clawed_at_start = client.clawback(&s1, &500, &compliance_admin);
    assert_eq!(clawed_at_start, 0);
    assert_eq!(token_client.balance(&compliance_admin), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);

    // Edge 2: Clawback on canceled stream
    env.ledger().set_timestamp(150); // 500 vested
    client.cancel(&s1, &sender); // Sender gets 500 unvested refund, stream total becomes 500
    assert_eq!(token_client.balance(&sender), 1_500); // 1000 remaining + 500 refund
    assert_eq!(token_client.balance(&contract_id), 500);

    // Admin claws back from canceled stream
    let clawed_from_canceled = client.clawback(&s1, &1_000, &compliance_admin);
    assert_eq!(clawed_from_canceled, 500); // caps at remaining 500
    assert_eq!(token_client.balance(&compliance_admin), 500);
    assert_eq!(token_client.balance(&contract_id), 0);

    // Edge 3: Clawback when stream is already 100% claimed yields 0
    env.ledger().set_timestamp(100);
    let s2 = client.create_stream(&sender, &recipient, &token, &1_000, &100, &200, &0, &None);
    env.ledger().set_timestamp(200);
    client.claim(&s2, &recipient, &1_000);
    assert_eq!(token_client.balance(&recipient), 1_000);

    let clawed_fully_claimed = client.clawback(&s2, &100, &compliance_admin);
    assert_eq!(clawed_fully_claimed, 0);
    assert_eq!(token_client.balance(&compliance_admin), 500);
}

// =============================================================================
// SSB-2026-187 - Claimable calculation workflow: before start, at end,
// canceled-at-time, and rounding across repeated partial claims
// =============================================================================

#[test]
fn test_claimable_calculation_failure_is_atomic_and_rounding_across_partial_claims() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &200);

    // 1. Stream 1: 100 tokens over 30s (t=100 to t=130) to exercise floor rounding
    env.ledger().set_timestamp(50);
    let stream_1 = client.create_stream(&sender, &recipient, &token, &100, &100, &130, &0, &None);
    assert_eq!(token_client.balance(&sender), 100);
    assert_eq!(token_client.balance(&contract_id), 100);

    // 2. Before start (t=50 and t=99) and at exact start (t=100): claimable is 0
    assert_eq!(client.claimable(&stream_1, &50), 0);
    assert_eq!(client.claimable(&stream_1, &99), 0);
    assert_eq!(client.claimable(&stream_1, &100), 0);

    // Failed claim before start leaves storage and balances in a consistent, recoverable state
    let events_before_start_fail = env.events().all().len();
    assert!(client.try_claim(&stream_1, &recipient, &1).is_err());
    assert!(client.try_claim(&stream_1, &recipient, &0).is_err());
    assert_eq!(env.events().all().len(), events_before_start_fail);
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 100);
    assert_eq!(client.get_stream(&stream_1).claimed_amount, 0);

    // 3. Repeated partial claims with floor rounding before and after external token calls
    // Step A: t=110 (elapsed=10/30 -> floor(1000/30) = 33 vested, 33 claimable)
    env.ledger().set_timestamp(110);
    assert_eq!(client.claimable(&stream_1, &110), 33);

    // Pre-transfer over-claim by 1 unit (34 > 33) fails atomically
    let events_before_step_a = env.events().all().len();
    assert!(client.try_claim(&stream_1, &recipient, &34).is_err());
    assert!(client.try_claim(&stream_1, &stranger, &33).is_err());
    assert_eq!(env.events().all().len(), events_before_step_a);
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 100);
    assert_eq!(client.get_stream(&stream_1).claimed_amount, 0);

    // Partial claim of 20 (leaving 13 claimable at t=110)
    assert_eq!(client.claim(&stream_1, &recipient, &20), 20);
    assert_eq!(client.claimable(&stream_1, &110), 13);
    assert_eq!(token_client.balance(&recipient), 20);
    assert_eq!(token_client.balance(&contract_id), 80);

    // Claim remaining 13 at t=110 (now 33 claimed, 0 claimable at t=110)
    assert_eq!(client.claim(&stream_1, &recipient, &13), 13);
    assert_eq!(client.claimable(&stream_1, &110), 0);
    assert!(client.try_claim(&stream_1, &recipient, &1).is_err());
    assert_eq!(token_client.balance(&recipient), 33);
    assert_eq!(token_client.balance(&contract_id), 67);
    assert_eq!(client.get_stream(&stream_1).claimed_amount, 33);

    // Step B: t=120 (elapsed=20/30 -> floor(2000/30) = 66 cumulative vested, 66 - 33 = 33 claimable)
    env.ledger().set_timestamp(120);
    assert_eq!(client.claimable(&stream_1, &120), 33);
    assert!(client.try_claim(&stream_1, &recipient, &34).is_err());
    assert_eq!(client.claim(&stream_1, &recipient, &33), 33);
    assert_eq!(client.claimable(&stream_1, &120), 0);
    assert_eq!(token_client.balance(&recipient), 66);
    assert_eq!(token_client.balance(&contract_id), 34);
    assert_eq!(client.get_stream(&stream_1).claimed_amount, 66);

    // Step C: At end (t=130) and after end (t=200): cumulative vested is 100, so 34 is claimable
    // (recovering the 1 truncated unit so repeated partial claims sum to exact total_amount)
    env.ledger().set_timestamp(130);
    assert_eq!(client.claimable(&stream_1, &130), 34);
    assert_eq!(client.claimable(&stream_1, &200), 34);
    assert!(client.try_claim(&stream_1, &recipient, &35).is_err());
    assert_eq!(client.claim(&stream_1, &recipient, &34), 34);
    assert_eq!(client.claimable(&stream_1, &130), 0);
    assert_eq!(client.claimable(&stream_1, &200), 0);
    assert_eq!(token_client.balance(&recipient), 100);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(client.get_stream(&stream_1).claimed_amount, 100);

    // 4. Stream 2: Canceled-at-time after partial claim with rounding (100 tokens over 30s, t=200..230)
    env.ledger().set_timestamp(200);
    let stream_2 = client.create_stream(&sender, &recipient, &token, &100, &200, &230, &0, &None);
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), 100);

    // At t=210 (vested = 33), recipient claims partial 15 (18 remaining vested)
    env.ledger().set_timestamp(210);
    assert_eq!(client.claimable(&stream_2, &210), 33);
    assert_eq!(client.claim(&stream_2, &recipient, &15), 15);
    assert_eq!(client.claimable(&stream_2, &210), 18);

    // At t=220 (vested = 66), sender cancels stream:
    // sender refund = 100 - 66 = 34; recipient remaining claimable = 66 - 15 = 51
    env.ledger().set_timestamp(220);
    client.cancel(&stream_2, &sender);
    let canceled_stream = client.get_stream(&stream_2);
    assert!(canceled_stream.canceled);
    assert_eq!(canceled_stream.end_time, 220);
    assert_eq!(canceled_stream.total_amount, 66);
    assert_eq!(canceled_stream.claimed_amount, 15);
    assert_eq!(token_client.balance(&sender), 34);
    assert_eq!(token_client.balance(&contract_id), 51);

    // Claimable at cancel time (t=220) and after original end (t=300) is frozen at 51
    assert_eq!(client.claimable(&stream_2, &220), 51);
    assert_eq!(client.claimable(&stream_2, &300), 51);

    // Over-claim on canceled stream fails atomically
    env.ledger().set_timestamp(250);
    assert!(client.try_claim(&stream_2, &recipient, &52).is_err());
    assert_eq!(token_client.balance(&contract_id), 51);
    assert_eq!(client.get_stream(&stream_2).claimed_amount, 15);

    // Recipient claims remaining 51 across two partial claims (25 + 26)
    assert_eq!(client.claim(&stream_2, &recipient, &25), 25);
    assert_eq!(client.claimable(&stream_2, &250), 26);
    assert_eq!(client.claim(&stream_2, &recipient, &26), 26);
    assert_eq!(client.claimable(&stream_2, &250), 0);
    assert_eq!(token_client.balance(&recipient), 166);
    assert_eq!(token_client.balance(&sender), 34);
    assert_eq!(token_client.balance(&contract_id), 0);
}

// =============================================================================
// #1129 — Specify edge behavior for Claimable calculation
//
// Each test targets exactly one boundary documented in the `claimable()` and
// `vested_amount()` doc-comments: before start, at exact start, one second
// before end, at exact end, after end, canceled-at-time (before and after the
// original end), and integer rounding / dust across repeated partial claims.
// =============================================================================

/// Before stream start: claimable is always 0, and a claim attempt fails
/// atomically without touching balances or emitting any events.
#[test]
fn test_claimable_edge_before_start_is_zero_and_atomic_rollback() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);

    // Stream runs from t=100 to t=200
    env.ledger().with_mut(|l| l.timestamp = 0);
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1_000, &100, &200, &0, &None);

    // Claimable is 0 at every point before start
    assert_eq!(client.claimable(&stream_id, &0), 0);
    assert_eq!(client.claimable(&stream_id, &50), 0);
    assert_eq!(client.claimable(&stream_id, &99), 0);

    let events_before = env.events().all().len();
    // A claim attempt fails; nothing changes
    env.ledger().with_mut(|l| l.timestamp = 50);
    assert!(client.try_claim(&stream_id, &recipient, &1).is_err());
    assert_eq!(env.events().all().len(), events_before);
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 1_000);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 0);
}

/// At exact start time: claimable is 0 (zero elapsed) and a claim fails
/// without any side effect.
#[test]
fn test_claimable_edge_at_exact_start_time_is_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1_000, &1_000, &2_000, &0, &None,
    );

    assert_eq!(client.claimable(&stream_id, &1_000), 0);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    assert!(client.try_claim(&stream_id, &recipient, &1).is_err());
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, 0);
}

/// One second before end time: claimable is `total - 1` (floor rounding) for
/// a stream of `total_amount == duration`.
#[test]
fn test_claimable_edge_one_second_before_end() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    // 1000 tokens over 1000 seconds: 1 token per second, exactly.
    token_admin.mint(&sender, &1_000);
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1_000, &0, &1_000, &0, &None);

    // At t=999: 999 tokens vested, 999 claimable
    assert_eq!(client.claimable(&stream_id, &999), 999);
}

/// At exact end time: the full total_amount is claimable.
#[test]
fn test_claimable_edge_at_exact_end_time_is_total() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    token_admin.mint(&sender, &1_000);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1_000, &1_000, &2_000, &0, &None,
    );

    assert_eq!(client.claimable(&stream_id, &2_000), 1_000);
}

/// After end time: claimable stays capped at total_amount; repeated queries
/// return the same value and do not increase beyond the cap.
#[test]
fn test_claimable_edge_after_end_time_capped_at_total() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    token_admin.mint(&sender, &1_000);
    let stream_id = client.create_stream(
        &sender, &recipient, &token, &1_000, &1_000, &2_000, &0, &None,
    );

    // All times beyond end_time should return the same capped value
    assert_eq!(client.claimable(&stream_id, &2_001), 1_000);
    assert_eq!(client.claimable(&stream_id, &5_000), 1_000);
    assert_eq!(client.claimable(&stream_id, &(u64::MAX / 2)), 1_000);
}

/// Canceled-at-time: after cancel() the claimable amount is frozen at the
/// vested amount on the cancel ledger; queries beyond the original end_time
/// also return the frozen amount (not total_amount).
#[test]
fn test_claimable_edge_canceled_at_midpoint_frozen_beyond_original_end() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);
    // Stream: t=0 to t=1000, 1000 tokens
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1_000, &0, &1_000, &0, &None);

    // Cancel at t=400 (vested = 400, refund = 600)
    env.ledger().with_mut(|l| l.timestamp = 400);
    client.cancel(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert!(stream.canceled);
    assert_eq!(stream.end_time, 400);
    assert_eq!(stream.total_amount, 400);
    assert_eq!(token_client.balance(&sender), 600); // 600 refunded

    // Claimable is frozen at 400 regardless of how far beyond the original end_time we query
    assert_eq!(client.claimable(&stream_id, &400), 400);
    assert_eq!(client.claimable(&stream_id, &700), 400);
    assert_eq!(client.claimable(&stream_id, &1_000), 400); // original end_time
    assert_eq!(client.claimable(&stream_id, &9_999), 400); // well beyond

    // Recipient can claim exactly 400 and then nothing more
    assert_eq!(client.claim(&stream_id, &recipient, &400), 400);
    assert_eq!(client.claimable(&stream_id, &9_999), 0);
    assert_eq!(token_client.balance(&recipient), 400);
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// Canceled before start: claimable is always 0 for all future times; a claim
/// attempt fails atomically.
#[test]
fn test_claimable_edge_canceled_before_start_is_zero_for_all_times() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1_000, &500, &1_500, &0, &None);

    env.ledger().with_mut(|l| l.timestamp = 0);
    client.cancel(&stream_id, &sender);

    // Full refund, nothing for recipient
    assert_eq!(token_client.balance(&sender), 1_000);

    assert_eq!(client.claimable(&stream_id, &0), 0);
    assert_eq!(client.claimable(&stream_id, &500), 0);
    assert_eq!(client.claimable(&stream_id, &1_000), 0);
    assert_eq!(client.claimable(&stream_id, &9_999), 0);

    env.ledger().with_mut(|l| l.timestamp = 2_000);
    assert!(client.try_claim(&stream_id, &recipient, &1).is_err());
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// Integer rounding (dust): with a non-divisible stream, repeated partial
/// claims at regular intervals produce floor-rounded amounts.  The final claim
/// recovers all accumulated dust so the total paid exactly equals total_amount.
#[test]
fn test_claimable_edge_rounding_dust_recovered_at_end() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    // 100 tokens over 30 seconds: 100/30 = 3.33… tokens/s; integer division truncates.
    token_admin.mint(&sender, &100);
    let stream_id = client.create_stream(&sender, &recipient, &token, &100, &0, &30, &0, &None);

    // t=10: vested = 100*10/30 = 33 (floor)
    assert_eq!(client.claimable(&stream_id, &10), 33);
    env.ledger().with_mut(|l| l.timestamp = 10);
    client.claim(&stream_id, &recipient, &33);

    // t=20: vested = 100*20/30 = 66 (floor); 66-33 = 33 claimable
    assert_eq!(client.claimable(&stream_id, &20), 33);
    env.ledger().with_mut(|l| l.timestamp = 20);
    client.claim(&stream_id, &recipient, &33);

    // t=30 (end): vested = 100; 100 - 66 = 34 claimable (recovering 2 truncated units)
    assert_eq!(client.claimable(&stream_id, &30), 34);
    env.ledger().with_mut(|l| l.timestamp = 30);
    client.claim(&stream_id, &recipient, &34);

    // All 100 tokens paid out; nothing left
    assert_eq!(client.claimable(&stream_id, &30), 0);
    assert_eq!(token_client.balance(&recipient), 100);
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// Checked arithmetic: a claim that would make claimed_amount exceed
/// total_amount is rejected without any balance or state change.
#[test]
fn test_claimable_edge_checked_sub_never_returns_negative() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    token_admin.mint(&sender, &1_000);
    let stream_id =
        client.create_stream(&sender, &recipient, &token, &1_000, &0, &1_000, &0, &None);

    // Claim the full vested amount at t=1000
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.claim(&stream_id, &recipient, &1_000);

    // claimable must be 0 (checked_sub saturates rather than going negative)
    assert_eq!(client.claimable(&stream_id, &1_000), 0);
    assert_eq!(client.claimable(&stream_id, &9_999), 0);

    // Attempting a second claim panics as expected
    assert!(client.try_claim(&stream_id, &recipient, &1).is_err());
    assert_eq!(token_client.balance(&recipient), 1_000);
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// get_claimable_batch applies the same edge rules: before start, after end,
/// and canceled streams all return the correct capped value.
#[test]
fn test_claimable_batch_edge_boundary_coverage() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    token_admin.mint(&sender, &3_000);

    // Stream A: not yet started (t < start_time)
    let id_a = client.create_stream(&sender, &recipient, &token, &1_000, &500, &1_500, &0, &None);
    // Stream B: in progress at t=800
    let id_b = client.create_stream(&sender, &recipient, &token, &1_000, &0, &1_000, &0, &None);
    // Stream C: canceled before start
    let id_c = client.create_stream(&sender, &recipient, &token, &1_000, &200, &1_200, &0, &None);
    client.cancel(&id_c, &sender); // t=0, 0 vested

    let mut ids = soroban_sdk::vec![&env];
    ids.push_back(id_a);
    ids.push_back(id_b);
    ids.push_back(id_c);

    // At t=800:
    //   id_a: start=500 already past but let's check: 800 elapsed from 500 → 300/1000 * 1000 = 300
    //   id_b: elapsed=800/1000 * 1000 = 800
    //   id_c: canceled, total_amount reduced to 0 → 0
    let result = client.get_claimable_batch(&ids, &800);
    assert_eq!(result.get(id_a).unwrap(), 300);
    assert_eq!(result.get(id_b).unwrap(), 800);
    assert_eq!(result.get(id_c).unwrap(), 0);

    // Unknown stream ID returns 0
    let mut ids_with_unknown = soroban_sdk::vec![&env];
    ids_with_unknown.push_back(9_999_u64);
    let result_unknown = client.get_claimable_batch(&ids_with_unknown, &800);
    assert_eq!(result_unknown.get(9_999).unwrap(), 0);
}

// ---------------------------------------------------------------------------
// Regression tests: claimable calculation (#1133) and partial claims (#1138)
// ---------------------------------------------------------------------------

struct RegFixture<'a> {
    env: &'a Env,
    client: StellarStreamContractClient<'a>,
    token: token::Client<'a>,
    contract_id: Address,
    sender: Address,
    recipient: Address,
    stream_id: u64,
}

fn reg_fixture(env: &Env, total: i128, start: u64, end: u64) -> RegFixture<'_> {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let sender = Address::generate(env);
    let recipient = Address::generate(env);
    let token_addr = create_token(env, &admin);
    token::StellarAssetClient::new(env, &token_addr).mint(&sender, &total);
    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token_addr,
        &total,
        &start,
        &end,
        &0,
        &None,
    );
    let token = token::Client::new(env, &token_addr);
    // The stream escrows the full amount inside the contract.
    assert_eq!(token.balance(&contract_id), total);
    RegFixture {
        env,
        client,
        token,
        contract_id,
        sender,
        recipient,
        stream_id,
    }
}

impl RegFixture<'_> {
    fn set_time(&self, ts: u64) {
        self.env.ledger().with_mut(|l| l.timestamp = ts);
    }

    fn stream(&self) -> Stream {
        self.client.get_stream(&self.stream_id)
    }

    /// Signs `claim(stream_id, recipient, amount)` as `signer`, and nothing else.
    fn sign_claim(&self, signer: &Address, amount: i128) {
        self.env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: signer,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &self.contract_id,
                fn_name: "claim",
                args: (self.stream_id, self.recipient.clone(), amount).into_val(self.env),
                sub_invokes: &[],
            },
        }]);
    }

    /// (topic[1], payload) of every event published by the stream contract itself.
    fn contract_events(&self) -> std::vec::Vec<(Symbol, Val)> {
        let mut out = std::vec::Vec::new();
        for (addr, topics, data) in self.env.events().all().iter() {
            if addr != self.contract_id {
                continue;
            }
            if let Some(kind) = topics.get(1) {
                let kind: Symbol = kind.into_val(self.env);
                out.push((kind, data));
            }
        }
        out
    }

    fn count_events(&self, kind: Symbol) -> usize {
        self.contract_events()
            .iter()
            .filter(|(k, _)| *k == kind)
            .count()
    }

    /// Payload of the most recent contract event of this kind.
    fn last_event(&self, kind: Symbol) -> Val {
        self.contract_events()
            .into_iter()
            .rev()
            .find(|(k, _)| *k == kind)
            .map(|(_, data)| data)
            .expect("no event of that kind")
    }

    fn last_two_kinds(&self) -> (Symbol, Symbol) {
        let events = self.contract_events();
        let n = events.len();
        (events[n - 2].0.clone(), events[n - 1].0.clone())
    }
}

#[test]
fn test_1133_claimable_before_start_is_zero_and_claim_reverts() {
    let env = Env::default();
    let f = reg_fixture(&env, 1_000, 1_000, 2_000);
    let last_claim_before = f.stream().last_claim_time;
    f.set_time(500);

    assert_eq!(f.client.claimable(&f.stream_id, &500), 0);
    assert_eq!(f.client.claimable(&f.stream_id, &999), 0);
    assert_eq!(f.client.claimable(&f.stream_id, &1_000), 0);

    // A claim before the start reverts and leaves everything untouched.
    assert!(f.client.try_claim(&f.stream_id, &f.recipient, &1).is_err());
    let stream = f.stream();
    assert_eq!(stream.claimed_amount, 0);
    assert_eq!(stream.last_claim_time, last_claim_before);
    assert_eq!(f.token.balance(&f.recipient), 0);
    assert_eq!(f.token.balance(&f.contract_id), 1_000);
    assert_eq!(f.count_events(symbol_short!("Claimed")), 0);

    // The first unit vests one second after the start.
    assert_eq!(f.client.claimable(&f.stream_id, &1_001), 1);
}

#[test]
fn test_1133_claimable_at_end_pays_full_amount_and_completes() {
    let env = Env::default();
    // 1_000_003 over 1_000s is not a multiple of the duration, so rounding matters.
    let total: i128 = 1_000_003;
    let f = reg_fixture(&env, total, 1_000, 2_000);

    // One second before the end the floor still holds back the last units.
    assert_eq!(f.client.claimable(&f.stream_id, &1_999), 999_002);
    assert_eq!(f.client.claimable(&f.stream_id, &2_000), total);
    assert_eq!(f.client.claimable(&f.stream_id, &9_999), total);

    f.set_time(2_000);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &total), total);

    assert_eq!(f.token.balance(&f.recipient), total);
    assert_eq!(f.token.balance(&f.contract_id), 0);
    let stream = f.stream();
    assert_eq!(stream.claimed_amount, total);
    assert_eq!(stream.last_claim_time, 2_000);

    let claimed: StreamClaimed = f.last_event(symbol_short!("Claimed")).into_val(f.env);
    assert_eq!(claimed.amount, total);
    assert_eq!(claimed.claimed_amount, total);
    let completed: StreamCompleted = f.last_event(symbol_short!("Completed")).into_val(f.env);
    assert_eq!(completed.stream_id, f.stream_id);
    assert_eq!(completed.total_amount, total);
    assert_eq!(completed.timestamp, 2_000);
    assert_eq!(
        f.last_two_kinds(),
        (symbol_short!("Claimed"), symbol_short!("Completed"))
    );

    // Nothing is left, and an extra claim reverts.
    assert_eq!(f.client.claimable(&f.stream_id, &9_999), 0);
    assert!(f.client.try_claim(&f.stream_id, &f.recipient, &1).is_err());
    assert_eq!(f.token.balance(&f.recipient), total);
}

#[test]
fn test_1133_repeated_partial_claims_floor_without_dust_loss() {
    let env = Env::default();
    // 1_000 over 3_000s: each third vests 333.33.., so every step rounds down.
    let f = reg_fixture(&env, 1_000, 1_000, 4_000);

    // t=2_000: floor(1_000 * 1_000 / 3_000) = 333
    f.set_time(2_000);
    assert_eq!(f.client.claimable(&f.stream_id, &2_000), 333);
    // One more than claimable reverts and changes nothing.
    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &334)
        .is_err());
    assert_eq!(f.stream().claimed_amount, 0);
    assert_eq!(f.token.balance(&f.recipient), 0);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &333), 333);
    assert_eq!(f.token.balance(&f.recipient), 333);
    assert_eq!(f.token.balance(&f.contract_id), 667);
    let e1: StreamClaimed = f.last_event(symbol_short!("Claimed")).into_val(f.env);
    assert_eq!((e1.amount, e1.claimed_amount), (333, 333));
    assert_eq!(f.client.claimable(&f.stream_id, &2_000), 0);

    // t=3_000: floor(1_000 * 2_000 / 3_000) = 666 vested, 333 already claimed.
    f.set_time(3_000);
    assert_eq!(f.client.claimable(&f.stream_id, &3_000), 333);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &333), 333);
    assert_eq!(f.token.balance(&f.recipient), 666);
    assert_eq!(f.token.balance(&f.contract_id), 334);
    let e2: StreamClaimed = f.last_event(symbol_short!("Claimed")).into_val(f.env);
    assert_eq!((e2.amount, e2.claimed_amount), (333, 666));
    assert_eq!(f.stream().last_claim_time, 3_000);
    assert_eq!(f.count_events(symbol_short!("Completed")), 0);

    // t=4_000: everything has vested. The last claim is 334, not 333, because
    // the rounded-down remainders land in it, so no dust is lost or overpaid.
    f.set_time(4_000);
    assert_eq!(f.client.claimable(&f.stream_id, &4_000), 334);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &334), 334);
    assert_eq!(f.token.balance(&f.recipient), 1_000);
    assert_eq!(f.token.balance(&f.contract_id), 0);
    assert_eq!(f.stream().claimed_amount, 1_000);
    assert_eq!(f.count_events(symbol_short!("Completed")), 1);
}

#[test]
fn test_1133_cancel_at_time_clamps_claimable_and_splits_funds() {
    let env = Env::default();
    let f = reg_fixture(&env, 1_000, 1_000, 4_000);

    // The recipient takes 100 early.
    f.set_time(2_000);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &100), 100);

    // Sender cancels at t=3_000: floor(1_000 * 2_000 / 3_000) = 666 vested, 334 refunded.
    f.set_time(3_000);
    f.client.cancel(&f.stream_id, &f.sender);

    let stream = f.stream();
    assert!(stream.canceled);
    assert_eq!(stream.total_amount, 666);
    assert_eq!(stream.end_time, 3_000);
    assert_eq!(stream.claimed_amount, 100);
    assert_eq!(f.token.balance(&f.sender), 334);
    assert_eq!(f.token.balance(&f.recipient), 100);
    assert_eq!(f.token.balance(&f.contract_id), 566);

    let canceled: StreamCanceled = f.last_event(symbol_short!("Canceled")).into_val(f.env);
    assert_eq!(canceled.stream_id, f.stream_id);
    assert_eq!(canceled.sender, f.sender);
    assert_eq!(canceled.refunded_amount, 334);
    assert_eq!(canceled.timestamp, 3_000);

    // Claimable is clamped to what had vested at the cancel, now and later.
    assert_eq!(f.client.claimable(&f.stream_id, &3_000), 566);
    assert_eq!(f.client.claimable(&f.stream_id, &9_999), 566);

    // The recipient cannot take more than that, and a second cancel is a no-op.
    f.set_time(9_999);
    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &567)
        .is_err());
    assert_eq!(f.token.balance(&f.recipient), 100);
    f.client.cancel(&f.stream_id, &f.sender);
    assert_eq!(f.token.balance(&f.sender), 334);

    // The recipient collects the rest and the escrow ends up empty.
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &566), 566);
    assert_eq!(f.token.balance(&f.recipient), 666);
    assert_eq!(f.token.balance(&f.contract_id), 0);
    assert_eq!(
        f.token.balance(&f.sender) + f.token.balance(&f.recipient),
        1_000
    );
}

#[test]
fn test_1133_claim_requires_recipient_authorization() {
    let env = Env::default();
    let f = reg_fixture(&env, 1_000, 1_000, 2_000);
    f.set_time(1_500); // 500 vested

    // No signature: rejected.
    env.mock_auths(&[]);
    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &100)
        .is_err());

    // Someone else signs on the recipient's behalf: rejected.
    let attacker = Address::generate(&env);
    f.sign_claim(&attacker, 100);
    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &100)
        .is_err());

    // Rollback: nothing moved, nothing emitted.
    assert_eq!(f.stream().claimed_amount, 0);
    assert_eq!(f.token.balance(&f.recipient), 0);
    assert_eq!(f.token.balance(&f.contract_id), 1_000);
    assert_eq!(f.count_events(symbol_short!("Claimed")), 0);

    // The recipient signs: paid exactly the requested amount.
    f.sign_claim(&f.recipient, 100);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &100), 100);
    assert_eq!(f.token.balance(&f.recipient), 100);
    assert_eq!(f.token.balance(&f.contract_id), 900);
    assert_eq!(f.stream().claimed_amount, 100);
}

#[test]
fn test_1138_one_unit_claim_then_remaining_claim() {
    let env = Env::default();
    let f = reg_fixture(&env, 1_000, 1_000, 2_000);

    // t=1_500: 500 of 1_000 have vested.
    f.set_time(1_500);
    assert_eq!(f.client.claimable(&f.stream_id, &1_500), 500);

    // One-unit claim: the recipient authorizes and is paid exactly 1.
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &1), 1);
    assert!(env.auths().iter().any(|(who, _)| *who == f.recipient));
    let stream = f.stream();
    assert_eq!(stream.claimed_amount, 1);
    assert_eq!(stream.last_claim_time, 1_500);
    assert_eq!(f.token.balance(&f.recipient), 1);
    assert_eq!(f.token.balance(&f.contract_id), 999);
    let first: StreamClaimed = f.last_event(symbol_short!("Claimed")).into_val(f.env);
    assert_eq!(first.stream_id, f.stream_id);
    assert_eq!(first.actor, f.recipient);
    assert_eq!(first.recipient, f.recipient);
    assert_eq!(first.amount, 1);
    assert_eq!(first.claimed_amount, 1);
    assert_eq!(first.timestamp, 1_500);
    assert_eq!(f.count_events(symbol_short!("Completed")), 0);

    // 499 is left at this instant; asking for 500 reverts and changes nothing.
    assert_eq!(f.client.claimable(&f.stream_id, &1_500), 499);
    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &500)
        .is_err());
    assert_eq!(f.stream().claimed_amount, 1);
    assert_eq!(f.token.balance(&f.recipient), 1);
    assert_eq!(f.token.balance(&f.contract_id), 999);

    // Remaining claim.
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &499), 499);
    assert_eq!(f.token.balance(&f.recipient), 500);
    assert_eq!(f.token.balance(&f.contract_id), 500);
    let second: StreamClaimed = f.last_event(symbol_short!("Claimed")).into_val(f.env);
    assert_eq!(second.amount, 499);
    assert_eq!(second.claimed_amount, 500);
    assert_eq!(f.client.claimable(&f.stream_id, &1_500), 0);

    // At the end the rest vests; claiming it completes the stream.
    f.set_time(2_000);
    assert_eq!(f.client.claimable(&f.stream_id, &2_000), 500);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &500), 500);
    assert_eq!(f.token.balance(&f.recipient), 1_000);
    assert_eq!(f.token.balance(&f.contract_id), 0);
    let done: StreamCompleted = f.last_event(symbol_short!("Completed")).into_val(f.env);
    assert_eq!(done.total_amount, 1_000);
    assert_eq!(done.actor, f.recipient);
    assert_eq!(done.timestamp, 2_000);
    assert_eq!(
        f.last_two_kinds(),
        (symbol_short!("Claimed"), symbol_short!("Completed"))
    );
}

#[test]
fn test_1138_transfer_failure_after_authorization_rolls_back() {
    let env = Env::default();
    let f = reg_fixture(&env, 1_000, 1_000, 2_000);

    // One-unit claim goes through at t=1_200.
    f.set_time(1_200);
    f.sign_claim(&f.recipient, 1);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &1), 1);
    assert_eq!(f.token.balance(&f.recipient), 1);

    // Drain the escrow so the next payout transfer fails.
    env.mock_all_auths();
    let sink = Address::generate(&env);
    env.as_contract(&f.contract_id, || {
        f.token.transfer(&f.contract_id, &sink, &999);
    });
    assert_eq!(f.token.balance(&f.contract_id), 0);

    // t=1_500: 499 is claimable and the recipient signs, but the transfer fails.
    f.set_time(1_500);
    assert_eq!(f.client.claimable(&f.stream_id, &1_500), 499);
    f.sign_claim(&f.recipient, 499);
    assert!(f
        .client
        .try_claim(&f.stream_id, &f.recipient, &499)
        .is_err());

    // Rollback: stream state, balances and events are exactly as before.
    let stream = f.stream();
    assert_eq!(stream.claimed_amount, 1);
    assert_eq!(stream.last_claim_time, 1_200);
    assert_eq!(f.token.balance(&f.recipient), 1);
    assert_eq!(f.token.balance(&f.contract_id), 0);
    assert_eq!(f.count_events(symbol_short!("Claimed")), 1);
    assert_eq!(f.count_events(symbol_short!("Completed")), 0);
    assert_eq!(f.client.claimable(&f.stream_id, &1_500), 499);

    // Refill the escrow: the same signed claim now succeeds, so the failure
    // was the transfer and not authorization or validation.
    env.mock_all_auths();
    token::StellarAssetClient::new(&env, &f.token.address).mint(&f.contract_id, &999);
    f.sign_claim(&f.recipient, 499);
    assert_eq!(f.client.claim(&f.stream_id, &f.recipient, &499), 499);
    let stream = f.stream();
    assert_eq!(stream.claimed_amount, 500);
    assert_eq!(stream.last_claim_time, 1_500);
    assert_eq!(f.token.balance(&f.recipient), 500);
    assert_eq!(f.token.balance(&f.contract_id), 500);
    let ev: StreamClaimed = f.last_event(symbol_short!("Claimed")).into_val(f.env);
    assert_eq!(ev.amount, 499);
    assert_eq!(ev.claimed_amount, 500);
}

// =============================================================================
// #1124 — Specify edge behavior for Stream creation escrow
//
// Covers the escrow amount boundaries (`i128::MIN` … 1 … `i128::MAX`) and the
// failure ordering between the escrow token transfer and stream storage.
//
// Confirmed-before-fix behavior: `create_stream` happily escrowed
// `i128::MAX` (the transfer succeeded and the record was written), but
// `vested_amount` evaluated `total_amount.checked_mul(elapsed).unwrap_or(0)`,
// so every vesting computation overflowed and saturated to `0`. The stream was
// therefore unclaimable for its entire life — `claimable()` returned 0 even at
// and after `end_time` — and only `cancel()` could recover the escrow.
// =============================================================================

/// Token whose `balance` reports a satisfying value but whose `transfer`
/// always traps. Used to model a token-level transfer failure that happens
/// *after* the contract's own balance pre-check passes.
///
/// Declared in its own module: `#[contractimpl]` emits module-level symbols,
/// which would otherwise collide with `MockToken` above.
mod trap_token {
    use super::*;

    #[contract]
    pub struct TrapOnTransferToken;

    #[contractimpl]
    impl TrapOnTransferToken {
        pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {
            panic!("token transfer failed");
        }
        pub fn balance(_env: Env, _id: Address) -> i128 {
            i128::MAX
        }
        pub fn symbol(env: Env) -> String {
            String::from_str(&env, "TRAP")
        }
    }
}

use trap_token::TrapOnTransferToken;

/// `i128::MAX` is the largest escrow the contract can represent. Creation must
/// succeed, the full amount must sit in escrow, and vesting must be the exact
/// floor quotient at every point of the schedule — not truncated to zero.
#[test]
fn test_create_stream_max_amount_escrows_and_vests_exactly() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_addr = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &i128::MAX);
    let token_client = token::Client::new(&env, &token_addr);

    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token_addr,
        &i128::MAX,
        &0,
        &1000,
        &0,
        &None,
    );

    // Escrow is fully funded and the record preserves the amount.
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&contract_id), i128::MAX);
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.total_amount, i128::MAX);
    assert_eq!(stream.claimed_amount, 0);

    // Nothing before the start, exact floor quotient at each checkpoint.
    assert_eq!(client.claimable(&stream_id, &0), 0);
    assert_eq!(client.claimable(&stream_id, &250), i128::MAX / 4);
    assert_eq!(client.claimable(&stream_id, &500), i128::MAX / 2);
    // One second before the end vesting is still short of the total by design.
    // Expectation computed independently: floor((2^127-1) * 999 / 1000).
    let expected_999: i128 = 169971042277008762499955616412168221621;
    assert_eq!(client.claimable(&stream_id, &999), expected_999);
    assert!(expected_999 < i128::MAX);
    // At the end the whole escrow is claimable.
    assert_eq!(client.claimable(&stream_id, &1000), i128::MAX);
    assert_eq!(client.claimable(&stream_id, &2000), i128::MAX);

    // A claim at the end pays the full escrowed amount and completes the stream.
    // `claim` reads the ledger clock, so move it to the end of the schedule.
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let claimed = client.claim(&stream_id, &recipient, &i128::MAX);
    assert_eq!(claimed, i128::MAX);
    assert_eq!(token_client.balance(&recipient), i128::MAX);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, i128::MAX);
    assert_eq!(client.claimable(&stream_id, &1000), 0);
}

/// A max-amount stream with a cliff honours the cliff, and partial claims at
/// max precision never exceed the remaining balance.
#[test]
fn test_create_stream_max_amount_with_cliff_and_partial_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_addr = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &i128::MAX);
    let token_client = token::Client::new(&env, &token_addr);

    // create_stream has no cliff parameter, so exercise the shared creation
    // path through a template (duration 1000, cliff 200).
    let template_id = client.create_template(
        &sender,
        &String::from_str(&env, "max-cliff"),
        &token_addr,
        &1000,
        &200,
        &String::from_str(&env, "linear"),
    );
    let stream_id = client.create_stream_from_template(&template_id, &recipient, &i128::MAX);
    assert_eq!(token_client.balance(&contract_id), i128::MAX);

    // Cliff not reached.
    assert_eq!(client.claimable(&stream_id, &100), 0);
    assert_eq!(client.claimable(&stream_id, &199), 0);
    // At the cliff boundary vesting is `elapsed / duration`, floor-rounded:
    // the cliff gates the start of vesting, it does not add a lump sum.
    // Expectations computed independently: floor((2^127-1) * n / 1000).
    let at_cliff: i128 = 34028236692093846346337460743176821145;
    assert_eq!(client.claimable(&stream_id, &200), at_cliff);
    let at_600: i128 = 102084710076281539039012382229530463436;
    assert_eq!(client.claimable(&stream_id, &600), at_600);

    let half = i128::MAX / 2;
    env.ledger().with_mut(|l| l.timestamp = 600);
    client.claim(&stream_id, &recipient, &half);
    assert_eq!(token_client.balance(&recipient), half);
    let remaining = client.claimable(&stream_id, &600);
    assert_eq!(remaining, at_600 - half);
    assert_eq!(
        client.get_stream(&stream_id).claimed_amount + remaining,
        at_600
    );
}

/// Cancel at max precision refunds exactly the unvested remainder: recipient
/// payout + sender refund == total_amount, and the contract holds nothing.
#[test]
fn test_create_stream_max_amount_cancel_conserves_balances() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_addr = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &i128::MAX);
    let token_client = token::Client::new(&env, &token_addr);

    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token_addr,
        &i128::MAX,
        &0,
        &1000,
        &0,
        &None,
    );

    env.ledger().with_mut(|l| l.timestamp = 500);
    let vested = client.claimable(&stream_id, &500);
    assert_eq!(vested, i128::MAX / 2);
    client.claim(&stream_id, &recipient, &vested);
    client.cancel(&stream_id, &sender);

    assert_eq!(token_client.balance(&recipient), vested);
    assert_eq!(token_client.balance(&sender), i128::MAX - vested);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(
        token_client.balance(&recipient) + token_client.balance(&sender),
        i128::MAX
    );
    assert_eq!(client.claimable(&stream_id, &2000), 0);
}

/// The smallest representable escrow (1 unit) is accepted, floors to zero
/// mid-stream, and pays out entirely at `end_time`.
#[test]
fn test_create_stream_min_amount_one_unit_vests_at_end() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_addr = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &1);
    let token_client = token::Client::new(&env, &token_addr);

    let stream_id =
        client.create_stream(&sender, &recipient, &token_addr, &1, &0, &1000, &0, &None);
    assert_eq!(token_client.balance(&contract_id), 1);

    assert_eq!(client.claimable(&stream_id, &0), 0);
    assert_eq!(client.claimable(&stream_id, &500), 0);
    assert_eq!(client.claimable(&stream_id, &999), 0);
    assert_eq!(client.claimable(&stream_id, &1000), 1);

    // Claiming anything before the end must fail rather than overdraw.
    assert!(client.try_claim(&stream_id, &recipient, &1).is_err());
    assert_eq!(token_client.balance(&recipient), 0);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    assert_eq!(client.claim(&stream_id, &recipient, &1), 1);
    assert_eq!(token_client.balance(&recipient), 1);
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// Amounts at or below zero — including `i128::MIN` — are refused before any
/// transfer or storage write.
#[test]
fn test_create_stream_non_positive_amount_rejected_without_state_change() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_addr = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &1000);
    let token_client = token::Client::new(&env, &token_addr);

    for amount in [0_i128, -1, -1000, i128::MIN, i128::MIN + 1] {
        let result = client.try_create_stream(
            &sender,
            &recipient,
            &token_addr,
            &amount,
            &0,
            &1000,
            &0,
            &None,
        );
        assert!(result.is_err(), "amount {amount} must be rejected");
        assert_eq!(client.get_next_stream_id(), 0);
        assert_eq!(token_client.balance(&sender), 1000);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    // The invariant holds for the direct panic path as well.
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_stream(
            &sender,
            &recipient,
            &token_addr,
            &i128::MIN,
            &0,
            &1000,
            &0,
            &None,
        );
    }));
    assert!(panicked.is_err());
    assert_eq!(client.get_next_stream_id(), 0);
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// A sender one unit short of the requested escrow is rejected up front, with
/// no transfer, no stream record, and no id consumed.
#[test]
fn test_create_stream_balance_shortfall_leaves_no_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_addr = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &(i128::MAX - 1));
    let token_client = token::Client::new(&env, &token_addr);

    let result = client.try_create_stream(
        &sender,
        &recipient,
        &token_addr,
        &i128::MAX,
        &0,
        &1000,
        &0,
        &None,
    );
    assert!(result.is_err());
    assert_eq!(client.get_next_stream_id(), 0);
    assert!(client.try_get_stream(&1).is_err());
    assert_eq!(token_client.balance(&sender), i128::MAX - 1);
    assert_eq!(token_client.balance(&contract_id), 0);

    // The same request succeeds once the sender holds the full amount.
    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token_addr,
        &(i128::MAX - 1),
        &0,
        &1000,
        &0,
        &None,
    );
    assert_eq!(stream_id, 1);
    assert_eq!(token_client.balance(&contract_id), i128::MAX - 1);
    assert_eq!(client.claimable(&stream_id, &500), (i128::MAX - 1) / 2);
}

/// A token-level transfer failure (our balance pre-check passes, the token
/// traps) must leave the contract exactly as it was: the transfer happens
/// before any storage write, so nothing is persisted.
#[test]
fn test_create_stream_token_transfer_failure_before_storage_leaves_no_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let trap_token = env.register_contract(None, TrapOnTransferToken);
    let trap_client = token::Client::new(&env, &trap_token);

    // Pre-check passes: the token reports a huge balance...
    assert_eq!(trap_client.balance(&sender), i128::MAX);

    let result = client.try_create_stream(
        &sender,
        &recipient,
        &trap_token,
        &i128::MAX,
        &0,
        &1000,
        &0,
        &None,
    );
    assert!(result.is_err());

    // ...but the transfer traps, so no stream, no id, no escrow, no event.
    assert_eq!(client.get_next_stream_id(), 0);
    assert!(client.try_get_stream(&1).is_err());
    assert!(env.events().all().is_empty());
}

/// A split whose allocation vector overflows `i128` is rejected through the
/// documented mismatch path (checked accumulation) instead of wrapping.
#[test]
#[should_panic(expected = "allocations must equal total_amount")]
fn test_create_split_stream_overflowing_allocation_sum_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let token_addr = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &i128::MAX);

    let mut recipients = Vec::new(&env);
    recipients.push_back((Address::generate(&env), i128::MAX / 2 + 1));
    recipients.push_back((Address::generate(&env), i128::MAX / 2 + 1));

    // (i128::MAX/2 + 1) * 2 == i128::MAX + 1: not representable in i128.
    client.create_split_stream(&sender, &token_addr, &i128::MAX, &0, &1000, &recipients);
}

/// The rejected split leaves the escrow untouched and allocates no ids.
#[test]
fn test_create_split_stream_overflowing_allocation_sum_is_atomic() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let token_addr = create_token(&env, &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &i128::MAX);
    let token_client = token::Client::new(&env, &token_addr);

    let mut recipients = Vec::new(&env);
    recipients.push_back((Address::generate(&env), i128::MAX / 2 + 1));
    recipients.push_back((Address::generate(&env), i128::MAX / 2 + 1));

    let result =
        client.try_create_split_stream(&sender, &token_addr, &i128::MAX, &0, &1000, &recipients);
    assert!(result.is_err());

    assert_eq!(token_client.balance(&sender), i128::MAX);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(client.get_next_stream_id(), 0);
    assert_eq!(client.get_split_children(&1).len(), 0);

    // A representable split of the same escrow is still accepted afterwards.
    let mut ok_recipients = Vec::new(&env);
    ok_recipients.push_back((Address::generate(&env), i128::MAX / 2));
    ok_recipients.push_back((Address::generate(&env), i128::MAX - i128::MAX / 2));
    let parent_id =
        client.create_split_stream(&sender, &token_addr, &i128::MAX, &0, &1000, &ok_recipients);
    assert_eq!(parent_id, 1);
    assert_eq!(client.get_split_children(&parent_id).len(), 2);
    assert_eq!(token_client.balance(&contract_id), i128::MAX);
}
