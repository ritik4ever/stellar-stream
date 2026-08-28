#![allow(dead_code)]

use soroban_sdk::{contracttype, Env, Vec};

/// A percentage of a stream released after `period_seconds` from its start.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingStep {
    pub period_seconds: u64,
    pub percentage_bps: u32,
}

pub const MAX_STEPS: u32 = 5;
pub const BPS_DENOMINATOR: i128 = 10_000;

pub fn validate_steps(steps: &Vec<VestingStep>) {
    if steps.len() > MAX_STEPS {
        panic!("at most 5 vesting steps are allowed");
    }

    let mut total_bps = 0u32;
    let mut previous_period = 0u64;
    for step in steps.iter() {
        if step.period_seconds == 0 || step.period_seconds <= previous_period {
            panic!("vesting step periods must be increasing");
        }
        total_bps = total_bps
            .checked_add(step.percentage_bps)
            .expect("vesting percentage overflow");
        previous_period = step.period_seconds;
    }
    if total_bps != 10_000 {
        panic!("vesting percentages must sum to 10000 bps");
    }
}

pub fn vested_amount(
    env: &Env,
    stream_start: u64,
    stream_end: u64,
    paused: bool,
    pause_started_at: Option<u64>,
    total_amount: i128,
    steps: &Vec<VestingStep>,
    at_time: u64,
) -> i128 {
    let effective_now = if paused {
        pause_started_at.unwrap_or(at_time)
    } else {
        at_time
    };
    let elapsed = effective_now.saturating_sub(stream_start);
    let mut released_bps = 0u32;
    for step in steps.iter() {
        if elapsed >= step.period_seconds {
            released_bps = released_bps.saturating_add(step.percentage_bps);
        }
    }
    if effective_now >= stream_end {
        released_bps = 10_000;
    }
    total_amount
        .checked_mul(released_bps as i128)
        .expect("vesting amount overflow")
        / BPS_DENOMINATOR
}

pub fn reached_steps(
    env: &Env,
    stream_start: u64,
    paused: bool,
    pause_started_at: Option<u64>,
    steps: &Vec<VestingStep>,
    at_time: u64,
) -> Vec<u32> {
    let effective_now = if paused {
        pause_started_at.unwrap_or(at_time)
    } else {
        at_time
    };
    let elapsed = effective_now.saturating_sub(stream_start);
    let mut reached = Vec::new(env);
    for (index, step) in steps.iter().enumerate() {
        if elapsed >= step.period_seconds {
            reached.push_back(index as u32);
        }
    }
    reached
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schedule(env: &Env) -> Vec<VestingStep> {
        soroban_sdk::vec![
            env,
            VestingStep {
                period_seconds: 3,
                percentage_bps: 2_500
            },
            VestingStep {
                period_seconds: 6,
                percentage_bps: 2_500
            },
            VestingStep {
                period_seconds: 12,
                percentage_bps: 5_000
            },
        ]
    }

    #[test]
    fn validates_bps_and_releases_steps_incrementally() {
        let env = Env::default();
        let steps = schedule(&env);
        validate_steps(&steps);
        assert_eq!(vested_amount(&env, 0, 12, false, None, 1_000, &steps, 2), 0);
        assert_eq!(
            vested_amount(&env, 0, 12, false, None, 1_000, &steps, 3),
            250
        );
        assert_eq!(
            vested_amount(&env, 0, 12, false, None, 1_000, &steps, 6),
            500
        );
        assert_eq!(
            vested_amount(&env, 0, 12, false, None, 1_000, &steps, 12),
            1_000
        );
    }

    #[test]
    fn reached_steps_are_reported_once_by_index() {
        let env = Env::default();
        let steps = schedule(&env);
        assert_eq!(reached_steps(&env, 0, false, None, &steps, 6).len(), 2);
    }
}
