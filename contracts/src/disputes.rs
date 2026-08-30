use crate::errors::ContractError;
use crate::{read_stream, DataKey};
use soroban_sdk::{contracttype, symbol_short, token::Client as TokenClient, Address, Env, String};

const DISPUTE_WINDOW_SECONDS: u64 = 7 * 24 * 60 * 60; // 7 days

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DisputeKey {
    Dispute(u64),
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DisputeResolution {
    Recipient,
    Sender,
    Split(i128), // amount going to recipient; remainder to sender
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dispute {
    pub stream_id: u64,
    pub recipient: Address,
    pub filed_at: u64,
    pub locked_amount: i128,
    pub resolved: bool,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeFiled {
    pub stream_id: u64,
    pub actor: Address,
    pub timestamp: u64,
    pub locked_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeResolved {
    pub stream_id: u64,
    pub actor: Address,
    pub timestamp: u64,
    pub resolution: DisputeResolution,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NATIVE_SENTINEL: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

fn resolve_token(env: &Env, token: &Address) -> Address {
    if token.to_string() == String::from_str(env, NATIVE_SENTINEL) {
        env.storage()
            .instance()
            .get(&DataKey::NativeToken)
            .unwrap_or_else(|| panic!("not initialized"))
    } else {
        token.clone()
    }
}

// ---------------------------------------------------------------------------
// Entry points (called from StellarStreamContract via pub fns below)
// ---------------------------------------------------------------------------

/// Recipient disputes a sender cancellation. Must be called within 7 days of
/// the cancellation. Locks the remaining unclaimed vested amount in escrow.
pub fn file_dispute(
    env: Env,
    stream_id: u64,
    recipient: Address,
) -> Result<(), ContractError> {
    recipient.require_auth();

    let stream = read_stream(&env, stream_id);

    if stream.recipient != recipient {
        panic!("recipient mismatch");
    }
    if !stream.canceled {
        panic!("stream not canceled");
    }

    // Enforce 7-day window. `end_time` was clamped to the cancel timestamp in
    // `cancel`, so it approximates when the cancellation happened.
    let now = env.ledger().timestamp();
    if now > stream.end_time.saturating_add(DISPUTE_WINDOW_SECONDS) {
        return Err(ContractError::DisputeWindowExpired);
    }

    // Prevent duplicate disputes.
    if env
        .storage()
        .persistent()
        .has(&DisputeKey::Dispute(stream_id))
    {
        return Err(ContractError::DisputeAlreadyFiled);
    }

    // The locked amount is whatever the recipient hasn't claimed yet.
    let locked_amount = stream.total_amount - stream.claimed_amount;
    if locked_amount <= 0 {
        panic!("nothing to dispute");
    }

    let dispute = Dispute {
        stream_id,
        recipient: recipient.clone(),
        filed_at: now,
        locked_amount,
        resolved: false,
    };

    env.storage()
        .persistent()
        .set(&DisputeKey::Dispute(stream_id), &dispute);

    env.events().publish(
        (symbol_short!("Dispute"), symbol_short!("Filed")),
        DisputeFiled {
            stream_id,
            actor: recipient,
            timestamp: now,
            locked_amount,
        },
    );

    Ok(())
}

/// Admin resolves a pending dispute. Releases locked funds according to the
/// chosen resolution and marks the dispute as resolved.
pub fn resolve_dispute(
    env: Env,
    stream_id: u64,
    admin: Address,
    resolution: DisputeResolution,
) -> Result<(), ContractError> {
    // Verify admin.
    let admin_stored: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic!("not initialized"));
    if admin_stored != admin {
        return Err(ContractError::Unauthorized);
    }
    admin.require_auth();

    let mut dispute: Dispute = env
        .storage()
        .persistent()
        .get(&DisputeKey::Dispute(stream_id))
        .unwrap_or_else(|| panic!("dispute not found"));

    if dispute.resolved {
        panic!("dispute already resolved");
    }

    let stream = read_stream(&env, stream_id);
    let actual_token = resolve_token(&env, &stream.token);
    let token_client = TokenClient::new(&env, &actual_token);
    let contract_address = env.current_contract_address();
    let locked = dispute.locked_amount;

    match resolution.clone() {
        DisputeResolution::Recipient => {
            token_client.transfer(&contract_address, &dispute.recipient, &locked);
        }
        DisputeResolution::Sender => {
            token_client.transfer(&contract_address, &stream.sender, &locked);
        }
        DisputeResolution::Split(recipient_amount) => {
            if recipient_amount < 0 || recipient_amount > locked {
                panic!("invalid split amount");
            }
            let sender_amount = locked - recipient_amount;
            if recipient_amount > 0 {
                token_client.transfer(&contract_address, &dispute.recipient, &recipient_amount);
            }
            if sender_amount > 0 {
                token_client.transfer(&contract_address, &stream.sender, &sender_amount);
            }
        }
    }

    dispute.resolved = true;
    env.storage()
        .persistent()
        .set(&DisputeKey::Dispute(stream_id), &dispute);

    let now = env.ledger().timestamp();
    env.events().publish(
        (symbol_short!("Dispute"), symbol_short!("Resolved")),
        DisputeResolved {
            stream_id,
            actor: admin,
            timestamp: now,
            resolution,
        },
    );

    Ok(())
}

/// Returns the dispute for a given stream, if one exists.
pub fn get_dispute(env: Env, stream_id: u64) -> Option<Dispute> {
    env.storage()
        .persistent()
        .get(&DisputeKey::Dispute(stream_id))
}
