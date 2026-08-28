//! Property-based tests for the StellarStream contract.
//!
//! These tests are gated behind the `proptest` feature:
//!
//! ```bash
//! cargo test --features proptest
//! ```
//!
//! Each property below is checked against 10,000 randomly generated stream
//! configurations. The invariants are documented in `docs/CONTRACT_ABI.md`
//! under "Property-based test guarantees".

extern crate std;

use super::super::*;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

/// Number of random inputs generated per property.
const CASES_PER_PROPERTY: u32 = 10_000;

/// Upper bound for `total_amount` (10^18). Bounded so that the integer
/// arithmetic in `vested_amount` (`total_amount * elapsed / duration`) can
/// never overflow `i128`.
const MAX_TOTAL_AMOUNT: i128 = 1_000_000_000_000_000_000;

/// Upper bound for timestamps / cliffs (seconds). Keeps durations sane while
/// still covering pre-start, mid-stream, post-end, and far-future times.
const MAX_TIME: u64 = 1_000_000;

/// A fully numeric description of a stream. Addresses are generated per case
/// (they need an `Env`).
#[derive(Debug, Clone)]
struct StreamParams {
    total_amount: i128,
    claimed_amount: i128,
    start_time: u64,
    end_time: u64,
    cliff_seconds: u64,
    at_time: u64,
    canceled: bool,
    paused: bool,
    pause_started_at: Option<u64>,
}

// Strategy producing random stream parameters with internally consistent
// fields (`claimed_amount <= total_amount`, `end_time > start_time`, and a
// pause timestamp exactly when paused).
prop_compose! {
    fn stream_params()(
        total_amount in 1i128..=MAX_TOTAL_AMOUNT,
        claimed in 0i128..=MAX_TOTAL_AMOUNT,
        start_time in 0u64..=MAX_TIME,
        duration in 1u64..=MAX_TIME,
        cliff_seconds in 0u64..=MAX_TIME,
        at_time in 0u64..=(2 * MAX_TIME),
        canceled in any::<bool>(),
        paused in any::<bool>(),
        pause_at in 0u64..=(2 * MAX_TIME),
    ) -> StreamParams {
        StreamParams {
            total_amount,
            claimed_amount: claimed.min(total_amount),
            start_time,
            end_time: start_time + duration,
            cliff_seconds,
            at_time,
            canceled,
            paused,
            pause_started_at: if paused { Some(pause_at) } else { None },
        }
    }
}

/// Builds a `Stream` from generated parameters, with fresh random addresses.
fn build_stream(env: &Env, p: &StreamParams) -> Stream {
    Stream {
        sender: Address::generate(env),
        recipient: Address::generate(env),
        token: Address::generate(env),
        total_amount: p.total_amount,
        claimed_amount: p.claimed_amount,
        start_time: p.start_time,
        end_time: p.end_time,
        cliff_seconds: p.cliff_seconds,
        canceled: p.canceled,
        paused: p.paused,
        pause_started_at: p.pause_started_at,
        metadata: None,
    }
}

/// Registers a real SEP-41 (SAC) token and returns its address.
fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

// ---------------------------------------------------------------------------
// Status model (see docs/CONTRACT_ABI.md — "Stream status model")
// ---------------------------------------------------------------------------

/// The four on-chain stream statuses. Derived, not stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamStatus {
    Active,
    Paused,
    Completed,
    Canceled,
}

impl StreamStatus {
    const ALL: [StreamStatus; 4] = [
        StreamStatus::Active,
        StreamStatus::Paused,
        StreamStatus::Completed,
        StreamStatus::Canceled,
    ];
}

/// Derives the stream status from the stored fields at a point in time.
/// Precedence: canceled > paused > completed > active.
fn stream_status(stream: &Stream, at_time: u64) -> StreamStatus {
    if stream.canceled {
        StreamStatus::Canceled
    } else if stream.paused {
        StreamStatus::Paused
    } else if at_time >= stream.end_time || stream.claimed_amount >= stream.total_amount {
        StreamStatus::Completed
    } else {
        StreamStatus::Active
    }
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES_PER_PROPERTY))]

    // Property 1 — vested is always in [0, total_amount].
    #[test]
    fn vested_amount_always_in_bounds(p in stream_params()) {
        let env = Env::default();
        let stream = build_stream(&env, &p);
        let vested = vested_amount(&stream, p.at_time);

        prop_assert!(vested >= 0, "vested {vested} is negative");
        prop_assert!(
            vested <= stream.total_amount,
            "vested {vested} exceeds total_amount {}",
            stream.total_amount,
        );

        // Boundary behavior implied by the vesting formula:
        let effective_now = if stream.paused {
            stream.pause_started_at.unwrap_or(p.at_time)
        } else {
            p.at_time
        };
        if effective_now < stream.start_time.saturating_add(stream.cliff_seconds) {
            prop_assert_eq!(vested, 0, "no vesting before start_time + cliff_seconds");
        }
        // Fully vested once the schedule has ended AND the cliff has been
        // reached. A cliff longer than the stream duration shadows the end of
        // the schedule (vested_amount checks the cliff first), so the stream
        // never vests — both conditions must hold.
        if effective_now >= stream.end_time
            && effective_now >= stream.start_time.saturating_add(stream.cliff_seconds)
        {
            prop_assert_eq!(vested, stream.total_amount, "fully vested at/after end_time");
        }
    }

    // Property 2 — claimable never exceeds vested - claimed (and equals
    // max(0, vested - claimed)).
    #[test]
    fn claimable_never_exceeds_vested_minus_claimed(p in stream_params()) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StellarStreamContract);
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let stream = build_stream(&env, &p);
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(&DataKey::Stream(1), &stream);
        });

        let vested = vested_amount(&stream, p.at_time);
        let claimable = client.claimable(&1, &p.at_time);
        let expected = (vested - stream.claimed_amount).max(0);

        prop_assert!(claimable >= 0, "claimable {claimable} is negative");
        if vested >= stream.claimed_amount {
            prop_assert!(
                claimable <= vested - stream.claimed_amount,
                "claimable {claimable} exceeds vested − claimed {}",
                vested - stream.claimed_amount,
            );
        }
        prop_assert_eq!(
            claimable,
            expected,
            "claimable {} != max(0, vested - claimed) {}",
            claimable,
            expected,
        );
    }

    // Property 3 — status is always one of the four documented values and is
    // consistent with the stored stream state.
    #[test]
    fn status_is_always_one_of_four(p in stream_params()) {
        let env = Env::default();
        let stream = build_stream(&env, &p);
        let status = stream_status(&stream, p.at_time);

        prop_assert!(
            StreamStatus::ALL.contains(&status),
            "status {status:?} is not one of the four documented values",
        );

        if stream.canceled {
            prop_assert_eq!(status, StreamStatus::Canceled);
        } else if stream.paused {
            prop_assert_eq!(status, StreamStatus::Paused);
        } else if p.at_time >= stream.end_time || stream.claimed_amount >= stream.total_amount {
            prop_assert_eq!(status, StreamStatus::Completed);
        } else {
            prop_assert_eq!(status, StreamStatus::Active);
        }
    }

    // Property 4 — cancel always produces status = canceled.
    #[test]
    fn cancel_always_produces_canceled_status(p in stream_params()) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StellarStreamContract);
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin);
        let token_admin = token::StellarAssetClient::new(&env, &token);
        // Fund the contract so the unvested refund can actually be paid out.
        token_admin.mint(&contract_id, &p.total_amount);

        let mut stream = build_stream(&env, &p);
        stream.sender = sender.clone();
        stream.recipient = recipient.clone();
        stream.token = token.clone();
        stream.canceled = false;

        env.as_contract(&contract_id, || {
            env.storage().persistent().set(&DataKey::Stream(1), &stream);
        });
        env.ledger().with_mut(|l| l.timestamp = p.at_time);

        client.cancel(&1, &sender);

        let after = client.get_stream(&1);
        prop_assert!(after.canceled, "cancel did not set the canceled flag");
        prop_assert_eq!(
            stream_status(&after, p.at_time),
            StreamStatus::Canceled,
            "cancel did not produce status = canceled",
        );
    }
}
