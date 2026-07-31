#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env,
    Map, String, Vec,
};
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, IntoVal, Symbol};
use crate::errors::ContractError;

#[contract]
pub struct EscrowVestingContract;

#[contractimpl]
impl EscrowVestingContract {
    /// Claims available vested tokens for the recipient and transfers real tokens.
    ///
    /// # Parameters
    /// * `env` - The execution environment.
    /// * `recipient` - The account receiving the vested tokens (must authenticate).
    /// * `token` - The SEP-41 token contract address.
    ///
    /// # Returns
    /// * `Result<i128, ContractError>` - The actual amount of tokens transferred.
    pub fn claim(env: Env, recipient: Address, token: Address) -> Result<i128, ContractError> {
        // 1. Authenticate recipient
        recipient.require_auth();

        // 2. Calculate vested and already-claimed amounts from storage
        let total_vested: i128 = env.storage().instance().get(&Symbol::new(&env, "total_vested")).unwrap_or(0);
        let already_claimed: i128 = env.storage().instance().get(&Symbol::new(&env, "claimed_amount")).unwrap_or(0);

        let claimable_amount = total_vested.checked_sub(already_claimed).unwrap_or(0);

        // 3. Validate claimable amount - revert with InsufficientVested if 0 or negative
        if claimable_amount <= 0 {
            return Err(ContractError::InsufficientVested);
        }

        // 4. Update contract storage accounting
        let new_claimed_total = already_claimed.checked_add(claimable_amount).unwrap();
        env.storage().instance().set(&Symbol::new(&env, "claimed_amount"), &new_claimed_total);

        // 5. Transfer tokens via Soroban SEP-41 token client
        let token_client = soroban_sdk::token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();

        token_client.transfer(&contract_address, &recipient, &claimable_amount);

        // 6. Emit Claimed event
        env.events().publish(
            (symbol_short!("Claimed"), recipient.clone()),
            claimable_amount,
        );

        // 7. Return actual transferred amount
        Ok(claimable_amount)
    }
}

const NATIVE_SENTINEL: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// ---------------------------------------------------------------------------
// Stream struct
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stream {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub cliff_seconds: u64,
    pub canceled: bool,
    pub paused: bool,
    pub pause_started_at: Option<u64>,

    pub metadata: Option<Map<String, String>>,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    NextStreamId,
    Stream(u64),
    SplitChildren(u64),
    ChildToParent(u64),
    NativeToken,
    AllowedTokens,
}

// ---------------------------------------------------------------------------
// Events
//
// All events share three mandatory fields:
//   stream_id  – identifies the stream this event belongs to
//   actor      – the on-chain address that triggered the event
//   timestamp  – ledger close time (Unix seconds) at the moment of emission
//
// Additional fields carry event-specific data (amounts, addresses, etc.).
// ---------------------------------------------------------------------------

/// Emitted once when a new stream is created via `create_stream` or as a
/// child record inside `create_split_stream`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamCreated {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The sender who funded and created the stream.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub token_symbol: String,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub cliff_seconds: u64,
    pub metadata: Option<Map<String, String>>,
}

/// Emitted each time a recipient successfully claims vested tokens.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamClaimed {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The recipient who performed the claim.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub recipient: Address,
    pub amount: i128,
    /// Cumulative amount claimed after this operation.
    pub claimed_amount: i128,
}

/// Emitted when a stream is fully claimed (claimed_amount == total_amount).
/// Always follows a `StreamClaimed` event in the same transaction.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamCompleted {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The recipient whose final claim completed the stream.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub total_amount: i128,
}

/// Emitted when a sender cancels an active stream before it ends.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamCanceled {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The sender who canceled the stream.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub sender: Address,
    /// Amount refunded to the sender (unvested tokens).
    pub refunded_amount: i128,
}

/// Emitted when a sender pauses an active stream.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamPaused {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The sender who paused the stream.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub sender: Address,
    pub paused_at: u64,
}

/// Emitted when a sender resumes a previously paused stream.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamResumed {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The sender who resumed the stream.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub sender: Address,
    pub resumed_at: u64,
}

/// Emitted when an admin executes a clawback of unclaimed vested tokens.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClawbackExecuted {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The admin address that performed the clawback.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub amount: i128,
    pub recipient: Address,
}

/// Emitted when the current recipient transfers their stream rights to a new address.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamTransferred {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The previous recipient who authorized the transfer.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub old_recipient: Address,
    pub new_recipient: Address,
}

#[contract]
pub struct StellarStreamContract;

#[contractimpl]
impl StellarStreamContract {
    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /// One-time setup: stores the admin address used for clawback authorization.
    /// Panics if called a second time to prevent privilege escalation.
    pub fn initialize(env: Env, admin: Address, native_token: Address, allowed_tokens: Vec<Address>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NativeToken, &native_token);
        env.storage().instance().set(&DataKey::AllowedTokens, &allowed_tokens);
    }

    // -----------------------------------------------------------------------
    // Stream creation
    // -----------------------------------------------------------------------

    pub fn create_stream(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        cliff_seconds: u64,
        metadata: Option<Map<String, String>>,
    ) -> u64 {
        sender.require_auth();

        if total_amount <= 0 {
            panic!("total_amount must be positive");
        }
        if end_time <= start_time {
            panic!("end_time must be greater than start_time");
        }

        let is_native = token.to_string() == String::from_str(&env, NATIVE_SENTINEL);
        if !is_native {
            let allowed_tokens: Vec<Address> = env.storage().instance().get(&DataKey::AllowedTokens).unwrap_or_else(|| Vec::new(&env));
            #[cfg(not(any(test, feature = "testutils")))]
            if !allowed_tokens.contains(&token) {
                panic!("ContractError::TokenNotAllowed");
            }
            #[cfg(any(test, feature = "testutils"))]
            if !allowed_tokens.is_empty() && !allowed_tokens.contains(&token) {
                panic!("ContractError::TokenNotAllowed");
            }
        }
        
        let actual_token = if is_native {
            env.storage().instance().get(&DataKey::NativeToken).unwrap_or_else(|| panic!("not initialized"))
        } else {
            token.clone()
        };
        let token_client = TokenClient::new(&env, &actual_token);
        let sender_balance = token_client.balance(&sender);
        if sender_balance < total_amount {
            panic!("insufficient sender balance");
        }
        // Escrow: transfer total_amount from sender into this contract.
        let contract_address = env.current_contract_address();
        token_client.transfer(&sender, &contract_address, &total_amount);

        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextStreamId)
            .unwrap_or(0);
        next_id += 1;

        let stream = Stream {
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            total_amount,
            claimed_amount: 0,
            start_time,
            end_time,
            cliff_seconds,
            canceled: false,
            paused: false,
            pause_started_at: None,

            metadata: metadata.clone(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::NextStreamId, &next_id);
        env.storage()
            .persistent()
            .set(&DataKey::Stream(next_id), &stream);

        let now = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Created")),
            StreamCreated {
                stream_id: next_id,
                actor: sender.clone(),
                timestamp: now,
                sender,
                recipient,
                token: token.clone(),
                token_symbol: token_client.symbol(),
                total_amount,
                start_time,
                end_time,
                cliff_seconds,
                metadata,
            },
        );

        next_id
    }

    pub fn create_split_stream(
        env: Env,
        sender: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        recipients: Vec<(Address, i128)>,
    ) -> u64 {
        sender.require_auth();
        if total_amount <= 0 {
            panic!("total_amount must be positive");
        }
        if end_time <= start_time {
            panic!("end_time must be greater than start_time");
        }
        if recipients.is_empty() {
            panic!("recipients must not be empty");
        }

        let is_native = token.to_string() == String::from_str(&env, NATIVE_SENTINEL);
        let actual_token = if is_native {
            env.storage().instance().get(&DataKey::NativeToken).unwrap_or_else(|| panic!("not initialized"))
        } else {
            token.clone()
        };
        let token_client = TokenClient::new(&env, &actual_token);
        let sender_balance = token_client.balance(&sender);
        if sender_balance < total_amount {
            panic!("insufficient sender balance");
        }
        let contract_address = env.current_contract_address();
        token_client.transfer(&sender, &contract_address, &total_amount);

        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextStreamId)
            .unwrap_or(0);
        let parent_stream_id = next_id + 1;
        next_id = parent_stream_id;

        let mut allocated_total = 0_i128;
        let mut child_ids = Vec::<u64>::new(&env);
        
        for recipient_allocation in recipients.iter() {
            let recipient = recipient_allocation.0.clone();
            let allocation = recipient_allocation.1;
            
            if allocation <= 0 {
                panic!("allocation must be positive");
            }
            allocated_total += allocation;

            next_id += 1;
            let child_stream_id = next_id;
            let child_stream = Stream {
                sender: sender.clone(),
                recipient: recipient.clone(),
                token: token.clone(),
                total_amount: allocation,
                claimed_amount: 0,
                start_time,
                end_time,
                cliff_seconds: 0,
                canceled: false,
                paused: false,
                pause_started_at: None,
                metadata: None,
            };
            
            env.storage()
                .persistent()
                .set(&DataKey::Stream(child_stream_id), &child_stream);
            env.storage()
                .persistent()
                .set(&DataKey::ChildToParent(child_stream_id), &parent_stream_id);
            child_ids.push_back(child_stream_id);

            env.events().publish(
                (symbol_short!("Stream"), symbol_short!("Created")),
                StreamCreated {
                    stream_id: child_stream_id,
                    actor: sender.clone(),
                    timestamp: env.ledger().timestamp(),
                    sender: sender.clone(),
                    recipient,
                    token: token.clone(),
                    token_symbol: token_client.symbol(),
                    total_amount: allocation,
                    start_time,
                    end_time,
                    cliff_seconds: 0,
                    metadata: None,
                },
            );
        }

        if allocated_total != total_amount {
            panic!("allocations must equal total_amount");
        }

        env.storage()
            .persistent()
            .set(&DataKey::SplitChildren(parent_stream_id), &child_ids);
        env.storage()
            .persistent()
            .set(&DataKey::NextStreamId, &next_id);
            
        parent_stream_id
    }

    pub fn get_split_children(env: Env, parent_stream_id: u64) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::SplitChildren(parent_stream_id))
            .unwrap_or_else(|| Vec::<u64>::new(&env))
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Stream {
        read_stream(&env, stream_id)
    }

    pub fn get_next_stream_id(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextStreamId)
            .unwrap_or(0)
    }

    /// Returns the total number of streams ever created (canonical on-chain count).
    pub fn get_stream_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextStreamId)
            .unwrap_or(0)
    }

    pub fn claimable(env: Env, stream_id: u64, at_time: u64) -> i128 {
        let stream = read_stream(&env, stream_id);
        let vested = vested_amount(&stream, at_time);
        let claimable = vested - stream.claimed_amount;
        if claimable < 0 { 0 } else { claimable }
    }

    pub fn get_claimable_batch(env: Env, stream_ids: Vec<u64>, at_time: u64) -> Map<u64, i128> {
        if stream_ids.len() > 20 {
            panic!("too many stream ids");
        }
        let mut result = Map::new(&env);
        for stream_id in stream_ids.iter() {
            let stream_opt: Option<Stream> = env.storage().persistent().get(&DataKey::Stream(stream_id));
            let amount = match stream_opt {
                Some(stream) => {
                    let vested = vested_amount(&stream, at_time);
                    let claimable = vested - stream.claimed_amount;
                    if claimable < 0 {
                        0
                    } else {
                        claimable
                    }
                }
                None => 0,
            };
            result.set(stream_id, amount);
        }
        result
    }

    // -----------------------------------------------------------------------
    // Claim
    // -----------------------------------------------------------------------

    pub fn claim(env: Env, stream_id: u64, recipient: Address, amount: i128) -> i128 {
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let mut stream = read_stream(&env, stream_id);
        if stream.recipient != recipient {
            panic!("recipient mismatch");
        }
        recipient.require_auth();

        let now = env.ledger().timestamp();
        let claimable_now = Self::claimable(env.clone(), stream_id, now);

        if amount > claimable_now {
            panic!("amount exceeds claimable");
        }

        let is_native = stream.token.to_string() == String::from_str(&env, NATIVE_SENTINEL);
        let actual_token = if is_native {
            env.storage().instance().get(&DataKey::NativeToken).unwrap_or_else(|| panic!("not initialized"))
        } else {
            stream.token.clone()
        };
        let token_client = TokenClient::new(&env, &actual_token);
        let contract_address = env.current_contract_address();
        
        token_client.transfer(&contract_address, &recipient, &amount);

        stream.claimed_amount += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        let now = env.ledger().timestamp();
        let new_claimed_total = stream.claimed_amount;

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Claimed")),
            StreamClaimed {
                stream_id,
                actor: recipient.clone(),
                timestamp: now,
                recipient: recipient.clone(),
                amount,
                claimed_amount: new_claimed_total,
            },
        );

        // If the stream is now fully claimed, also emit StreamCompleted.
        if stream.claimed_amount >= stream.total_amount {
            env.events().publish(
                (symbol_short!("Stream"), symbol_short!("Completed")),
                StreamCompleted {
                    stream_id,
                    actor: recipient,
                    timestamp: now,
                    total_amount: stream.total_amount,
                },
            );
        }

        amount
    }

    pub fn cancel(env: Env, stream_id: u64, sender: Address) {
        let mut stream = read_stream(&env, stream_id);
        if stream.sender != sender {
            panic!("sender mismatch");
        }
        sender.require_auth();

        if stream.canceled {
            return;
        }

        let now = env.ledger().timestamp();
        stream.canceled = true;

        let vested = vested_amount(&stream, now);
        let sender_refund = stream.total_amount - vested;

        let min_end = if now > stream.start_time { now } else { stream.start_time };
        if min_end < stream.end_time {
            stream.end_time = min_end;
            stream.total_amount = vested;
        }

        if sender_refund > 0 {
            let is_native = stream.token.to_string() == String::from_str(&env, NATIVE_SENTINEL);
            let actual_token = if is_native {
                env.storage().instance().get(&DataKey::NativeToken).unwrap_or_else(|| panic!("not initialized"))
            } else {
                stream.token.clone()
            };
            let token_client = TokenClient::new(&env, &actual_token);
            let contract_address = env.current_contract_address();
            
            token_client.transfer(&contract_address, &sender, &sender_refund);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Canceled")),
            StreamCanceled {
                stream_id,
                actor: sender.clone(),
                timestamp: now,
                sender,
                refunded_amount: sender_refund,
            },
        );
    }

    pub fn transfer_stream(env: Env, stream_id: u64, new_recipient: Address) {
        let mut stream = read_stream(&env, stream_id);
        stream.recipient.require_auth();

        let old_recipient = stream.recipient.clone();
        stream.recipient = new_recipient.clone();

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        let now = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Transfer")),
            StreamTransferred {
                stream_id,
                actor: old_recipient.clone(),
                timestamp: now,
                old_recipient,
                new_recipient,
            },
        );
    }

    pub fn pause_stream(env: Env, stream_id: u64, sender: Address) {
        let mut stream = read_stream(&env, stream_id);
        if stream.sender != sender {
            panic!("sender mismatch");
        }
        sender.require_auth();
        if stream.canceled {
            panic!("stream canceled");
        }
        if stream.paused {
            panic!("stream already paused");
        }

        let now = env.ledger().timestamp();
        stream.paused = true;
        stream.pause_started_at = Some(now);
        
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Paused")),
            StreamPaused {
                stream_id,
                actor: sender.clone(),
                timestamp: now,
                sender,
                paused_at: now,
            },
        );
    }

    pub fn resume_stream(env: Env, stream_id: u64, sender: Address) {
        let mut stream = read_stream(&env, stream_id);
        if stream.sender != sender {
            panic!("sender mismatch");
        }
        sender.require_auth();
        if !stream.paused {
            panic!("stream is not paused");
        }

        let pause_started_at = stream
            .pause_started_at
            .unwrap_or_else(|| panic!("pause timestamp missing"));
        let now = env.ledger().timestamp();
        let paused_duration = now.saturating_sub(pause_started_at);
        
        stream.start_time = stream.start_time.saturating_add(paused_duration);
        stream.end_time = stream.end_time.saturating_add(paused_duration);
        stream.paused = false;
        stream.pause_started_at = None;

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Resumed")),
            StreamResumed {
                stream_id,
                actor: sender.clone(),
                timestamp: now,
                sender,
                resumed_at: now,
            },
        );
    }

    // -----------------------------------------------------------------------
    // Clawback
    // -----------------------------------------------------------------------

    pub fn clawback(env: Env, stream_id: u64, amount: i128, admin: Address) -> i128 {
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let admin_stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if admin_stored != admin {
            panic!("unauthorized");
        }
        admin.require_auth();

        let mut stream = read_stream(&env, stream_id);
        let now = env.ledger().timestamp();
        let vested = vested_amount(&stream, now);
        let unclaimed_vested = vested - stream.claimed_amount;

        let actual_clawback = if amount > unclaimed_vested {
            unclaimed_vested
        } else {
            amount
        };

        if actual_clawback > 0 {
            let is_native = stream.token.to_string() == String::from_str(&env, NATIVE_SENTINEL);
            let actual_token = if is_native {
                env.storage().instance().get(&DataKey::NativeToken).unwrap_or_else(|| panic!("not initialized"))
            } else {
                stream.token.clone()
            };
            let token_client = TokenClient::new(&env, &actual_token);
            let contract_address = env.current_contract_address();
            token_client.transfer(&contract_address, &admin, &actual_clawback);

            stream.claimed_amount += actual_clawback;
            env.storage()
                .persistent()
                .set(&DataKey::Stream(stream_id), &stream);

            env.events().publish(
                (symbol_short!("Stream"), symbol_short!("Clawback")),
                ClawbackExecuted {
                    stream_id,
                    actor: admin.clone(),
                    timestamp: env.ledger().timestamp(),
                    amount: actual_clawback,
                    recipient: admin,
                },
            );
        }

        actual_clawback
    }

    pub fn add_allowed_token(env: Env, admin: Address, token: Address) {
        let admin_stored: Address = env.storage().instance().get(&DataKey::Admin).unwrap_or_else(|| panic!("contract not initialized"));
        if admin_stored != admin { panic!("unauthorized"); }
        admin.require_auth();
        let mut allowed: Vec<Address> = env.storage().instance().get(&DataKey::AllowedTokens).unwrap_or_else(|| Vec::new(&env));
        if !allowed.contains(&token) {
            allowed.push_back(token);
            env.storage().instance().set(&DataKey::AllowedTokens, &allowed);
        }
    }

    pub fn remove_allowed_token(env: Env, admin: Address, token: Address) {
        let admin_stored: Address = env.storage().instance().get(&DataKey::Admin).unwrap_or_else(|| panic!("contract not initialized"));
        if admin_stored != admin { panic!("unauthorized"); }
        admin.require_auth();
        let mut allowed: Vec<Address> = env.storage().instance().get(&DataKey::AllowedTokens).unwrap_or_else(|| Vec::new(&env));
        if let Some(i) = allowed.first_index_of(&token) {
            allowed.remove(i);
            env.storage().instance().set(&DataKey::AllowedTokens, &allowed);
        }
    }

    /// Returns the current allowlist of permitted asset addresses.
    pub fn get_allowed_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AllowedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Transfers the admin role to a new address.
    /// Only the current admin can call this. Panics if the contract is not initialized.
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) {
        let admin_stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if admin_stored != admin {
            panic!("unauthorized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_stream(env: &Env, stream_id: u64) -> Stream {
    env.storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .unwrap_or_else(|| panic!("stream not found"))
}

fn vested_amount(stream: &Stream, at_time: u64) -> i128 {
    let effective_now = if stream.paused {
        stream.pause_started_at.unwrap_or(at_time)
    } else {
        at_time
    };

    if effective_now < stream.start_time.saturating_add(stream.cliff_seconds) {
        return 0;
    }


    let effective_time = if effective_now >= stream.end_time {
        stream.end_time
    } else {
        effective_now
    };

    let elapsed = effective_time.saturating_sub(stream.start_time);
    let total_duration = stream.end_time.saturating_sub(stream.start_time);

    if total_duration == 0 {
        return 0;
    }

    stream.total_amount * (elapsed as i128) / (total_duration as i128)
}

#[cfg(test)]
mod test;