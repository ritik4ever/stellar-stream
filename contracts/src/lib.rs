#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env,
    Map, String, Vec,
};

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
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamCreated {
    pub stream_id: u64,
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

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamClaimed {
    pub stream_id: u64,
    pub recipient: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamCanceled {
    pub stream_id: u64,
    pub sender: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]

pub struct StreamPaused {
    pub stream_id: u64,
    pub sender: Address,
    pub paused_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamResumed {
    pub stream_id: u64,
    pub sender: Address,
    pub resumed_at: u64,

}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamStartTimeUpdated {
    pub stream_id: u64,
    pub sender: Address,
    pub old_start_time: u64,
    pub new_start_time: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClawbackExecuted {
    pub stream_id: u64,
    pub amount: i128,
    pub recipient: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamTransferred {
    pub stream_id: u64,
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

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Created")),
            StreamCreated {
                stream_id: next_id,
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

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Claimed")),
            StreamClaimed { stream_id, recipient, amount },
        );

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
            StreamCanceled { stream_id, sender },
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

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Transfer")),
            StreamTransferred {
                stream_id,
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
                sender,
                resumed_at: now,
            },
        );
    }

    // ---------------------------------------------------------------------------
    // Update start time
    // ---------------------------------------------------------------------------

    /// Update the start time of a stream.
    ///
    /// Only the original sender may invoke this function. The new start time
    /// must be strictly in the future relative to the current ledger time,
    /// strictly less than the stream's end time, and the stream must not be
    /// canceled. Emits a `Stream/StartUp` event so off-chain listeners can
    /// reconcile.
    pub fn update_start_time(env: Env, stream_id: u64, sender: Address, new_start_time: u64) {
        let mut stream = read_stream(&env, stream_id);
        if stream.sender != sender {
            panic!("sender mismatch");
        }
        sender.require_auth();

        if stream.canceled {
            panic!("stream canceled");
        }

        let now = env.ledger().timestamp();
        if new_start_time <= now {
            panic!("new_start_time must be in the future");
        }
        if new_start_time >= stream.end_time {
            panic!("new_start_time must be before stream end_time");
        }

        let old_start_time = stream.start_time;
        stream.start_time = new_start_time;

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("StartUp")),
            StreamStartTimeUpdated {
                stream_id,
                sender,
                old_start_time,
                new_start_time,
                updated_at: now,
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