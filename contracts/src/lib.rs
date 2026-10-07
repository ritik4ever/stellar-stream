#![no_std]

mod errors;

use crate::templates::{StreamTemplate, TemplateCreated};
use errors::ContractError;
pub mod dao;
pub mod templates;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env,
    Map, String, Symbol, TryFromVal, Val, Vec,
};

// ---------------------------------------------------------------------------
// Legacy escrow vesting contract
//
// Kept as a standalone submodule so its `claim` entry point does not collide
// with `StellarStreamContract::claim` in the generated contractimpl modules.
// It is only compiled in test builds: the two contracts both export a `claim`
// WASM symbol, which would collide in the release cdylib.
// ---------------------------------------------------------------------------

#[cfg(test)]
pub mod escrow {
    use super::*;
    use crate::errors::ContractError;
    use soroban_sdk::Symbol;

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
            let total_vested: i128 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "total_vested"))
                .unwrap_or(0);
            let already_claimed: i128 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "claimed_amount"))
                .unwrap_or(0);

            let claimable_amount = total_vested.checked_sub(already_claimed).unwrap_or(0);

            // 3. Validate claimable amount - revert with InsufficientVested if 0 or negative
            if claimable_amount <= 0 {
                return Err(ContractError::InsufficientVested);
            }

            // 4. Update contract storage accounting
            let new_claimed_total = already_claimed.checked_add(claimable_amount).unwrap();
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "claimed_amount"), &new_claimed_total);

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
}

const NATIVE_SENTINEL: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const MAX_TEMPLATES_PER_SENDER: u32 = 10;

// ---------------------------------------------------------------------------
// Upgrade compatibility — layout version
//
// `STREAM_LAYOUT_VERSION` is a monotonically increasing `u32` constant that
// encodes the current on-chain `Stream` struct layout.  Upgrade scripts and
// migration tooling call `get_contract_version()` to compare the deployed
// version against the version they were compiled against before touching any
// stream records.
//
// Rules:
//   • Bump the constant whenever a field is added, removed, or reordered in
//     `Stream` OR when a `DataKey` variant is renumbered.
//   • Never reuse a version number.
//   • Version 1 represents the initial layout (sender … metadata).
// ---------------------------------------------------------------------------
pub const STREAM_LAYOUT_VERSION: u32 = 1;

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
    pub vesting_type: String,
    /// Minimum seconds that must elapse between two claims (0 = no limit).
    pub min_claim_interval_seconds: u64,
    /// Ledger timestamp of the last successful claim (0 if never claimed).
    pub last_claim_time: u64,
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
    /// Monotonically increasing counter for stream IDs.
    /// Storage: **Persistent** — must survive ledger expiry so stream IDs
    /// never collide across upgrades. (Note: some older documentation
    /// incorrectly listed this as Instance storage; the code has always used
    /// Persistent.)
    NextStreamId,
    Stream(u64),
    NextTemplateId,
    Template(u64),
    SenderTemplates(Address),
    SplitChildren(u64),
    ChildToParent(u64),
    NativeToken,
    AllowedTokens,
    /// Stores the deployed `STREAM_LAYOUT_VERSION` (`u32`).
    /// Written by `initialize` and updated by any upgrade that changes the
    /// `Stream` layout.  Upgrade scripts read this key via `get_contract_version`
    /// to detect whether a migration is required before touching stream records.
    ContractVersion,
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
//
// ---------------------------------------------------------------------------
// Stable event payload contract (upgrade compatibility)
// ---------------------------------------------------------------------------
//
// The field names and types listed below form a **stable ABI**.  The backend
// indexer (backend/src/services/indexer.ts) deserializes these fields by name
// after calling `scValToNative`.  Any rename or type change is a breaking
// change that requires a coordinated indexer update.
//
// Mandatory base fields (present on every event struct, in this order):
//   1. stream_id  : u64
//   2. actor      : Address
//   3. timestamp  : u64
//
// Adding new optional fields to an existing struct is permitted; removing or
// reordering existing fields is not.
//
// ---------------------------------------------------------------------------
// Event emission ordering guarantee
// ---------------------------------------------------------------------------
//
// Within a single transaction the contract always emits events in this order:
//
//   claim()
//     1. `StreamClaimed`   — always emitted on a successful claim.
//     2. `StreamCompleted` — emitted immediately after `StreamClaimed` in the
//                            same transaction, only when `claimed_amount >=
//                            total_amount` after the claim.  The indexer can
//                            rely on `StreamClaimed` always preceding
//                            `StreamCompleted` for the same stream in the same
//                            ledger.
//
//   cancel()
//     1. `StreamCanceled`  — emitted once after state and token transfer.
//
// This ordering is tested by `test_claim_event_ordering_claimed_before_completed`
// in `src/test.rs`.
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
    pub vesting_type: String,
    pub min_claim_interval_seconds: u64,
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

/// Emitted when a claim attempt is rejected because the stream's minimum claim
/// interval has not elapsed since the last successful claim.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimThrottled {
    // --- mandatory base fields ---
    pub stream_id: u64,
    /// The recipient whose claim attempt was rejected.
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    /// Earliest timestamp at which the next claim will be accepted.
    pub next_allowed_claim_time: u64,
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
    pub fn initialize(
        env: Env,
        admin: Address,
        native_token: Address,
        allowed_tokens: Vec<Address>,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::NativeToken, &native_token);
        env.storage()
            .instance()
            .set(&DataKey::AllowedTokens, &allowed_tokens);
        // Record the layout version so upgrade scripts can detect migrations.
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &STREAM_LAYOUT_VERSION);
    }

    /// Returns the `STREAM_LAYOUT_VERSION` that was active when `initialize`
    /// was last called (or when the most recent layout-changing upgrade ran).
    ///
    /// Upgrade scripts compare this value against the constant compiled into
    /// the new WASM to decide whether a `Stream` layout migration is needed
    /// before any stream records are touched.  A `None` return means the
    /// contract was deployed before this key was introduced; treat it as
    /// version 0 and run any pending migrations.
    pub fn get_contract_version(env: Env) -> Option<u32> {
        env.storage().instance().get(&DataKey::ContractVersion)
    }

    /// Records the layout version after an upgrade migration completes.
    /// Only the current admin may update it, and the version cannot decrease
    /// or exceed the layout supported by this build.
    pub fn set_contract_version(env: Env, admin: Address, version: u32) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if stored_admin != admin {
            panic!("unauthorized");
        }
        admin.require_auth();

        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ContractVersion)
            .unwrap_or(0);
        if version < current_version || version > STREAM_LAYOUT_VERSION {
            panic!("invalid contract version");
        }

        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &version);
    }

    // -----------------------------------------------------------------------
    // Stream creation
    // -----------------------------------------------------------------------

    pub fn create_template(
        env: Env,
        sender: Address,
        name: String,
        token: Address,
        duration_seconds: u64,
        cliff_seconds: u64,
        vesting_type: String,
    ) -> u64 {
        sender.require_auth();

        if duration_seconds == 0 {
            panic!("duration must be positive");
        }
        if cliff_seconds > duration_seconds {
            panic!("cliff exceeds duration");
        }

        let mut sender_templates: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::SenderTemplates(sender.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        if sender_templates.len() >= MAX_TEMPLATES_PER_SENDER {
            panic!("template limit exceeded");
        }

        let mut template_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextTemplateId)
            .unwrap_or(0);
        template_id += 1;

        let template = StreamTemplate {
            id: template_id,
            sender: sender.clone(),
            name,
            token: token.clone(),
            duration_seconds,
            cliff_seconds,
            vesting_type: vesting_type.clone(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Template(template_id), &template);
        sender_templates.push_back(template_id);
        env.storage()
            .persistent()
            .set(&DataKey::SenderTemplates(sender.clone()), &sender_templates);
        env.storage()
            .persistent()
            .set(&DataKey::NextTemplateId, &template_id);

        env.events().publish(
            (symbol_short!("Template"), symbol_short!("Created")),
            TemplateCreated {
                template_id,
                sender,
                token,
                duration_seconds,
                cliff_seconds,
                vesting_type,
            },
        );

        template_id
    }

    pub fn get_template(env: Env, template_id: u64) -> StreamTemplate {
        read_template(&env, template_id)
    }

    pub fn get_templates_by_sender(env: Env, sender: Address) -> Vec<StreamTemplate> {
        let template_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::SenderTemplates(sender))
            .unwrap_or_else(|| Vec::new(&env));
        let mut templates = Vec::new(&env);
        for template_id in template_ids.iter() {
            templates.push_back(read_template(&env, template_id));
        }
        templates
    }

    pub fn create_stream_from_template(
        env: Env,
        template_id: u64,
        recipient: Address,
        amount: i128,
    ) -> u64 {
        let template = read_template(&env, template_id);

        let start_time = env.ledger().timestamp();
        let end_time = start_time.saturating_add(template.duration_seconds);

        create_stream_with_config(
            &env,
            template.sender,
            recipient,
            template.token,
            amount,
            start_time,
            end_time,
            template.cliff_seconds,
            template.vesting_type,
            0,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_stream(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        min_claim_interval_seconds: u64,
        metadata: Option<Map<String, String>>,
    ) -> u64 {
        create_stream_with_config(
            &env,
            sender,
            recipient,
            token,
            total_amount,
            start_time,
            end_time,
            0,
            String::from_str(&env, "linear"),
            min_claim_interval_seconds,
            metadata,
        )
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
            env.storage()
                .instance()
                .get(&DataKey::NativeToken)
                .unwrap_or_else(|| panic!("not initialized"))
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
                vesting_type: String::from_str(&env, "linear"),
                min_claim_interval_seconds: 0,
                last_claim_time: 0,
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
                    vesting_type: String::from_str(&env, "linear"),
                    min_claim_interval_seconds: 0,
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
        if claimable < 0 {
            0
        } else {
            claimable
        }
    }

    pub fn get_claimable_batch(env: Env, stream_ids: Vec<u64>, at_time: u64) -> Map<u64, i128> {
        if stream_ids.len() > 20 {
            panic!("too many stream ids");
        }
        let mut result = Map::new(&env);
        for stream_id in stream_ids.iter() {
            let stream_opt: Option<Stream> =
                env.storage().persistent().get(&DataKey::Stream(stream_id));
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

    /// Claims vested tokens for the recipient.
    ///
    /// Rate limiting: when the stream has a `min_claim_interval_seconds > 0`, a
    /// claim attempted before the interval has elapsed since the last successful
    /// claim is rejected with [`ContractError::ClaimTooFrequent`] (a
    /// `ClaimThrottled` event is emitted before the error is returned).
    ///
    /// # Event emission ordering guarantee
    ///
    /// On every successful claim this function emits events in the following
    /// fixed order within the same transaction:
    ///
    ///   1. `StreamClaimed`   — always emitted after the token transfer and
    ///                          accounting update succeed.
    ///   2. `StreamCompleted` — emitted immediately after `StreamClaimed`,
    ///                          **only** when `claimed_amount >= total_amount`.
    ///
    /// The indexer reconstructs the committed action exactly once by processing
    /// `StreamClaimed` first.  `StreamCompleted` is a secondary signal; the
    /// indexer must not double-count the amount from both events.
    pub fn claim(
        env: Env,
        stream_id: u64,
        recipient: Address,
        amount: i128,
    ) -> Result<i128, ContractError> {
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let mut stream = read_stream(&env, stream_id);
        if stream.recipient != recipient {
            panic!("recipient mismatch");
        }
        recipient.require_auth();

        let now = env.ledger().timestamp();

        // Rate-limited claims (anti-spam): reject claims that arrive before the
        // minimum interval has elapsed since the last successful claim.
        if stream.min_claim_interval_seconds > 0
            && stream.claimed_amount > 0
            && now
                < stream
                    .last_claim_time
                    .saturating_add(stream.min_claim_interval_seconds)
        {
            let next_allowed_claim_time = stream
                .last_claim_time
                .saturating_add(stream.min_claim_interval_seconds);
            env.events().publish(
                (symbol_short!("Stream"), symbol_short!("Throttled")),
                ClaimThrottled {
                    stream_id,
                    actor: recipient.clone(),
                    timestamp: now,
                    next_allowed_claim_time,
                },
            );
            return Err(ContractError::ClaimTooFrequent);
        }

        let claimable_now = Self::claimable(env.clone(), stream_id, now);

        if amount > claimable_now {
            panic!("amount exceeds claimable");
        }

        let is_native = stream.token.to_string() == String::from_str(&env, NATIVE_SENTINEL);
        let actual_token = if is_native {
            env.storage()
                .instance()
                .get(&DataKey::NativeToken)
                .unwrap_or_else(|| panic!("not initialized"))
        } else {
            stream.token.clone()
        };
        let token_client = TokenClient::new(&env, &actual_token);
        let contract_address = env.current_contract_address();

        token_client.transfer(&contract_address, &recipient, &amount);

        stream.claimed_amount += amount;
        stream.last_claim_time = now;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

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

        Ok(amount)
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

        let min_end = if now > stream.start_time {
            now
        } else {
            stream.start_time
        };
        if min_end < stream.end_time {
            stream.end_time = min_end;
            stream.total_amount = vested;
        }

        if sender_refund > 0 {
            let is_native = stream.token.to_string() == String::from_str(&env, NATIVE_SENTINEL);
            let actual_token = if is_native {
                env.storage()
                    .instance()
                    .get(&DataKey::NativeToken)
                    .unwrap_or_else(|| panic!("not initialized"))
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
                env.storage()
                    .instance()
                    .get(&DataKey::NativeToken)
                    .unwrap_or_else(|| panic!("not initialized"))
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
        let admin_stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if admin_stored != admin {
            panic!("unauthorized");
        }
        admin.require_auth();
        let mut allowed: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllowedTokens)
            .unwrap_or_else(|| Vec::new(&env));
        if !allowed.contains(&token) {
            allowed.push_back(token);
            env.storage()
                .instance()
                .set(&DataKey::AllowedTokens, &allowed);
        }
    }

    pub fn remove_allowed_token(env: Env, admin: Address, token: Address) {
        let admin_stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if admin_stored != admin {
            panic!("unauthorized");
        }
        admin.require_auth();
        let mut allowed: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllowedTokens)
            .unwrap_or_else(|| Vec::new(&env));
        if let Some(i) = allowed.first_index_of(&token) {
            allowed.remove(i);
            env.storage()
                .instance()
                .set(&DataKey::AllowedTokens, &allowed);
        }
    }

    /// Returns the current allowlist of permitted asset addresses.
    pub fn get_allowed_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AllowedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // -----------------------------------------------------------------------
    // Native XLM stream support (#688)
    // -----------------------------------------------------------------------
    //
    // `NativeToken` is the address of the SAC (Stellar Asset Contract) that
    // wraps native XLM for this network — the only address a Soroban
    // contract can present to the standard SEP-41 token interface to move
    // native balances; there is no lower-level, SAC-free path for a contract
    // to debit/credit XLM. Before this, that address could only be set once,
    // at `initialize()`, with no way to view or correct it afterward: a
    // wrong or stale address (e.g. after a network migration) permanently
    // broke every native-token stream (`create_stream`/`clawback` both
    // `panic!("not initialized")` on the missing key) with no recovery short
    // of redeploying the whole contract. `get_native_token`/`set_native_token`
    // give admins visibility and a correction path, matching the pattern
    // already used for `AllowedTokens`.

    /// Returns the configured native-XLM SAC address, if any.
    pub fn get_native_token(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::NativeToken)
    }

    /// Sets (or corrects) the native-XLM SAC address. Admin-only.
    pub fn set_native_token(env: Env, admin: Address, native_token: Address) {
        let admin_stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if admin_stored != admin {
            panic!("unauthorized");
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::NativeToken, &native_token);
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

#[allow(clippy::too_many_arguments)]
fn create_stream_with_config(
    env: &Env,
    sender: Address,
    recipient: Address,
    token: Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    cliff_seconds: u64,
    vesting_type: String,
    min_claim_interval_seconds: u64,
    metadata: Option<Map<String, String>>,
) -> u64 {
    sender.require_auth();

    if total_amount <= 0 {
        panic!("total_amount must be positive");
    }
    if end_time <= start_time {
        panic!("end_time must be greater than start_time");
    }

    let is_native = token.to_string() == String::from_str(env, NATIVE_SENTINEL);
    if !is_native {
        let allowed_tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllowedTokens)
            .unwrap_or_else(|| Vec::new(env));
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
        env.storage()
            .instance()
            .get(&DataKey::NativeToken)
            .unwrap_or_else(|| panic!("not initialized"))
    } else {
        token.clone()
    };
    let token_client = TokenClient::new(env, &actual_token);
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
        vesting_type: vesting_type.clone(),
        min_claim_interval_seconds,
        last_claim_time: 0,
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
            vesting_type,
            min_claim_interval_seconds,
            metadata,
        },
    );

    next_id
}

fn read_template(env: &Env, template_id: u64) -> StreamTemplate {
    env.storage()
        .persistent()
        .get(&DataKey::Template(template_id))
        .unwrap_or_else(|| panic!("template not found"))
}

fn read_stream(env: &Env, stream_id: u64) -> Stream {
    let key = DataKey::Stream(stream_id);
    let fields: Map<Symbol, Val> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic!("stream not found"));
    Stream {
        sender: read_stream_field(env, &fields, "sender"),
        recipient: read_stream_field(env, &fields, "recipient"),
        token: read_stream_field(env, &fields, "token"),
        total_amount: read_stream_field(env, &fields, "total_amount"),
        claimed_amount: read_stream_field(env, &fields, "claimed_amount"),
        start_time: read_stream_field(env, &fields, "start_time"),
        end_time: read_stream_field(env, &fields, "end_time"),
        cliff_seconds: read_stream_field_or(env, &fields, "cliff_seconds", 0),
        vesting_type: read_stream_field_or(
            env,
            &fields,
            "vesting_type",
            String::from_str(env, "linear"),
        ),
        min_claim_interval_seconds: read_stream_field_or(
            env,
            &fields,
            "min_claim_interval_seconds",
            0,
        ),
        last_claim_time: read_stream_field_or(env, &fields, "last_claim_time", 0),
        canceled: read_stream_field_or(env, &fields, "canceled", false),
        paused: read_stream_field_or(env, &fields, "paused", false),
        pause_started_at: read_stream_field_or(env, &fields, "pause_started_at", None),
        metadata: read_stream_field_or(env, &fields, "metadata", None),
    }
}

fn read_stream_field<T>(env: &Env, fields: &Map<Symbol, Val>, name: &str) -> T
where
    T: TryFromVal<Env, Val>,
{
    let value: Val = fields
        .get(Symbol::new(env, name))
        .unwrap_or_else(|| panic!("invalid stream"));
    T::try_from_val(env, &value).unwrap_or_else(|_| panic!("invalid stream"))
}

fn read_stream_field_or<T>(env: &Env, fields: &Map<Symbol, Val>, name: &str, default: T) -> T
where
    T: TryFromVal<Env, Val>,
{
    match fields.get(Symbol::new(env, name)) {
        Some(value) => T::try_from_val(env, &value).unwrap_or_else(|_| panic!("invalid stream")),
        None => default,
    }
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

    stream
        .total_amount
        .checked_mul(elapsed as i128)
        .unwrap_or(0)
        / (total_duration as i128)
}

#[cfg(test)]
mod test;
