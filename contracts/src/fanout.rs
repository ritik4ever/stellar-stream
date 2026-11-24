//! Multi-recipient fan-out streams (issue #674).
//!
//! A fan-out is a group of ordinary [`Stream`] records that are funded in one
//! transaction and share a single start/end window.  Each recipient's sub-stream
//! is a regular stream: it vests linearly, can be claimed individually, and is
//! visible to the existing `StreamCreated` / `StreamCanceled` events the
//! backend indexer already understands.
//!
//! The group itself is tracked under its own `FanoutDataKey` namespace so that
//! fan-out IDs never consume a `Stream(id)` slot that has no stream record:
//!
//! ```text
//! create_fanout_stream   → 1 transfer of the summed allocations
//!                        → N Stream(id) records + N StreamCreated events
//!                        → 1 Fanout(id) record + 1 FanoutStreamCreated event
//! cancel_fanout_stream   → N StreamCanceled events + N refunds to the sender
//!                        → 1 FanoutStreamCanceled event
//! ```
//!
//! # Atomicity
//!
//! Soroban executes every entry point as a single transaction, so a fan-out
//! cancel is all-or-none: if any sub-stream cannot be settled (for example a
//! refund transfer fails or a child record is missing), the whole invocation
//! reverts — including refunds already sent to earlier children and every
//! `canceled` flag already written.  There is no partial-cancel state to
//! reconcile.

use soroban_sdk::{
    contracttype, symbol_short, token::Client as TokenClient, Address, Env, String, Vec,
};

use crate::{read_stream, settle_cancel, validate_and_resolve_token, DataKey, Stream};

/// Maximum number of recipients in a single fan-out (issue #674).
pub const MAX_FANOUT_RECIPIENTS: u32 = 10;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
//
// Kept separate from `crate::DataKey` (like `DaoDataKey` in `dao.rs`) so the
// existing `Stream(id)` layout and `STREAM_LAYOUT_VERSION` are untouched by
// this feature.  Fan-out IDs come from their own counter, so they never
// reserve a `Stream(id)` slot that no record exists for.
#[contracttype]
pub enum FanoutDataKey {
    /// Monotonically increasing counter for fan-out IDs. Persistent, for the
    /// same reason as `NextStreamId`: IDs must not collide across upgrades.
    NextFanoutId,
    Fanout(u64),
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// The parent record of a fan-out group.
///
/// The individual allocations live in ordinary [`Stream`] records listed in
/// `stream_ids`; this record only stores the group-level facts.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FanoutStream {
    pub id: u64,
    pub sender: Address,
    /// The asset exactly as passed to `create_fanout_stream` (the native
    /// sentinel is preserved, matching `create_stream`).
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    /// Sub-stream IDs, in the same order as the `recipients` argument.
    pub stream_ids: Vec<u64>,
    pub canceled: bool,
}

/// Emitted once when a fan-out is created, carrying every sub-stream ID.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FanoutStreamCreated {
    // --- mandatory base fields (see lib.rs event ABI notes) ---
    pub fanout_id: u64,
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub sender: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub stream_ids: Vec<u64>,
}

/// Emitted once when a fan-out group is canceled.
///
/// The per-child `StreamCanceled` events are emitted as well; the indexer
/// should use those for stream state and this event only as a group-level
/// completion signal.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FanoutStreamCanceled {
    // --- mandatory base fields (see lib.rs event ABI notes) ---
    pub fanout_id: u64,
    pub actor: Address,
    pub timestamp: u64,
    // --- event-specific fields ---
    pub sender: Address,
    /// Sum of the refunds sent to the sender for the children settled by this
    /// call (children already canceled or fully claimed refund 0).
    pub refunded_amount: i128,
}

// ---------------------------------------------------------------------------
// Entry-point implementations
// ---------------------------------------------------------------------------

/// Creates one linearly-vesting stream per recipient and funds them all with a
/// single transfer.
///
/// The issue-specified signature has no separate `total_amount`: the total is
/// the sum of the `(recipient, allocation)` tuples.  The contract therefore
/// validates every allocation and the checked sum before moving exactly that
/// sum from the sender into escrow, so the fan-out can never collect more or
/// less than the recorded allocations.
///
/// Returns the fan-out ID.  Sub-stream IDs are available from
/// [`read_fanout`] and the `FanoutStreamCreated` event.
pub(crate) fn create_fanout_stream(
    env: &Env,
    sender: Address,
    recipients: Vec<(Address, u64)>,
    asset: Address,
    duration: u64,
) -> u64 {
    sender.require_auth();

    let recipient_count = recipients.len();
    if recipient_count == 0 {
        panic!("recipients must not be empty");
    }
    if recipient_count > MAX_FANOUT_RECIPIENTS {
        panic!("too many recipients");
    }
    if duration == 0 {
        panic!("duration must be positive");
    }

    // Sum with checked arithmetic: a tuple list must not be able to wrap the
    // total (and therefore the amount transferred) into a different number.
    let mut total_amount: i128 = 0;
    for entry in recipients.iter() {
        let allocation = entry.1;
        if allocation == 0 {
            panic!("allocation must be positive");
        }
        total_amount = total_amount
            .checked_add(allocation as i128)
            .unwrap_or_else(|| panic!("allocation total overflow"));
    }

    // Same allowlist and native-sentinel rules as `create_stream`, so fan-out
    // cannot be used to bypass the token allowlist.
    let actual_token = validate_and_resolve_token(env, &asset);
    let token_client = TokenClient::new(env, &actual_token);
    if token_client.balance(&sender) < total_amount {
        panic!("insufficient sender balance");
    }

    let start_time = env.ledger().timestamp();
    let end_time = start_time
        .checked_add(duration)
        .unwrap_or_else(|| panic!("duration overflow"));

    // Fund the whole group with one transfer; every child allocation is backed
    // by the escrow balance this transfer established.
    token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

    let mut fanout_id: u64 = env
        .storage()
        .persistent()
        .get(&FanoutDataKey::NextFanoutId)
        .unwrap_or(0);
    fanout_id += 1;
    env.storage()
        .persistent()
        .set(&FanoutDataKey::NextFanoutId, &fanout_id);

    let mut next_stream_id: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::NextStreamId)
        .unwrap_or(0);

    let token_symbol = token_client.symbol();
    let mut stream_ids = Vec::<u64>::new(env);

    for entry in recipients.iter() {
        let recipient = entry.0.clone();
        let allocation = entry.1 as i128;

        next_stream_id += 1;
        let stream_id = next_stream_id;

        let stream = Stream {
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: asset.clone(),
            total_amount: allocation,
            claimed_amount: 0,
            start_time,
            end_time,
            cliff_seconds: 0,
            vesting_type: String::from_str(env, "linear"),
            min_claim_interval_seconds: 0,
            last_claim_time: 0,
            canceled: false,
            paused: false,
            pause_started_at: None,
            metadata: None,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (symbol_short!("Stream"), symbol_short!("Created")),
            crate::StreamCreated {
                stream_id,
                actor: sender.clone(),
                timestamp: start_time,
                sender: sender.clone(),
                recipient,
                token: asset.clone(),
                token_symbol: token_symbol.clone(),
                total_amount: allocation,
                start_time,
                end_time,
                cliff_seconds: 0,
                vesting_type: String::from_str(env, "linear"),
                min_claim_interval_seconds: 0,
                metadata: None,
            },
        );

        stream_ids.push_back(stream_id);
    }

    env.storage()
        .persistent()
        .set(&DataKey::NextStreamId, &next_stream_id);

    let fanout = FanoutStream {
        id: fanout_id,
        sender: sender.clone(),
        token: asset.clone(),
        total_amount,
        start_time,
        end_time,
        stream_ids: stream_ids.clone(),
        canceled: false,
    };
    env.storage()
        .persistent()
        .set(&FanoutDataKey::Fanout(fanout_id), &fanout);

    env.events().publish(
        (symbol_short!("Fanout"), symbol_short!("Created")),
        FanoutStreamCreated {
            fanout_id,
            actor: sender.clone(),
            timestamp: start_time,
            sender,
            token: asset,
            total_amount,
            start_time,
            end_time,
            stream_ids,
        },
    );

    fanout_id
}

/// Cancels every sub-stream of `fanout_id` in one transaction and refunds the
/// unvested remainder to the sender.  Returns the total refunded.
///
/// Uses the same settlement rules as [`StellarStreamContract::cancel`]:
/// vesting is frozen at the cancel timestamp, the child's `end_time` and
/// `total_amount` are shrunk to what vested, and a `StreamCanceled` event is
/// emitted per child.
///
/// Children that were already canceled or fully claimed individually are
/// skipped — their funds were already settled — but the call still marks the
/// group canceled, so repeated calls are no-ops that refund nothing further.
///
/// The whole operation is all-or-none (see the module docs).
pub(crate) fn cancel_fanout_stream(env: &Env, fanout_id: u64, sender: Address) -> i128 {
    let mut fanout = read_fanout(env, fanout_id);
    if fanout.sender != sender {
        panic!("sender mismatch");
    }
    sender.require_auth();

    if fanout.canceled {
        return 0;
    }

    let now = env.ledger().timestamp();
    let mut refunded_amount: i128 = 0;

    for stream_id in fanout.stream_ids.iter() {
        let mut stream = read_stream(env, stream_id);
        if stream.canceled {
            continue;
        }
        refunded_amount += settle_cancel(env, stream_id, &mut stream, &sender, now);
    }

    fanout.canceled = true;
    env.storage()
        .persistent()
        .set(&FanoutDataKey::Fanout(fanout_id), &fanout);

    env.events().publish(
        (symbol_short!("Fanout"), symbol_short!("Canceled")),
        FanoutStreamCanceled {
            fanout_id,
            actor: sender.clone(),
            timestamp: now,
            sender,
            refunded_amount,
        },
    );

    refunded_amount
}

/// Returns the fan-out parent record (including all sub-stream IDs).
pub(crate) fn read_fanout(env: &Env, fanout_id: u64) -> FanoutStream {
    env.storage()
        .persistent()
        .get(&FanoutDataKey::Fanout(fanout_id))
        .unwrap_or_else(|| panic!("fanout not found"))
}
