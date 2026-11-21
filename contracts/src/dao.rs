//! DAO governance scaffold for StellarStream.
//!
//! Token holders govern protocol parameters — `FEE_BPS`, the admin address, and
//! `MIN_STREAM_DURATION` — through time-boxed, quorum-checked proposals.
//!
//! Lifecycle:
//! 1. `initialize` stores the governance token and initial parameters.
//! 2. During setup the admin has direct control (`set_admin`).
//! 3. `activate` switches the contract into DAO mode: after activation, admin
//!    changes are only possible through a passed `Admin` proposal.
//! 4. Token holders create proposals, vote with their token balance as weight
//!    (simple majority, min 10% of total token supply quorum), and anyone may
//!    execute a proposal once the 7-day voting period has ended.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env,
    Map,
};

/// Voting period length: 7 days (in seconds).
pub const VOTING_PERIOD_SECONDS: u64 = 7 * 24 * 60 * 60;
/// Quorum: minimum share of total token supply that must vote (basis points).
/// 1000 bps = 10%.
pub const QUORUM_BPS: i128 = 1000;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DaoDataKey {
    Admin,
    GovToken,
    NextProposalId,
    Proposal(u64),
    /// Address -> support (true = for, false = against) per proposal.
    ProposalVotes(u64),
    Params,
    /// Total governance token supply, captured at `initialize`.
    TotalSupply,
    Activated,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// What a proposal changes when executed.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProposalTarget {
    /// Change the protocol fee (in basis points).
    FeeBps(u64),
    /// Change the admin address.
    Admin(Address),
    /// Change the minimum allowed stream duration (seconds).
    MinStreamDuration(u64),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposal {
    pub id: u64,
    pub target: ProposalTarget,
    pub proposer: Address,
    /// Ledger timestamp when the proposal was created (voting starts now).
    pub created_at: u64,
    pub votes_for: i128,
    pub votes_against: i128,
    pub executed: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DaoParams {
    pub fee_bps: u64,
    pub min_stream_duration: u64,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when a new proposal is created.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalCreated {
    pub proposal_id: u64,
    pub proposer: Address,
    pub target: ProposalTarget,
    pub voting_end: u64,
    pub timestamp: u64,
}

/// Emitted for every recorded vote (weighted by the voter's token balance).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoteCast {
    pub proposal_id: u64,
    pub voter: Address,
    pub support: bool,
    pub weight: i128,
    pub timestamp: u64,
}

/// Emitted when a passed proposal is executed.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalExecuted {
    pub proposal_id: u64,
    pub target: ProposalTarget,
    pub timestamp: u64,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct DaoContract;

// The DAO shares the `stellar_stream` WASM binary with `StellarStreamContract`,
// so its entry points must not collide with that contract's exports
// (`initialize`, `set_admin`). The DAO entry points are therefore namespaced
// with the `dao_` prefix. To deploy the DAO as a standalone contract, move this
// file into its own crate (standard Soroban one-contract-per-crate layout).
#[contractimpl]
impl DaoContract {
    /// One-time setup. Only callable before initialization.
    ///
    /// `total_supply` is the total governance token supply used for the 10%
    /// quorum calculation (the SEP-41 token interface does not expose a
    /// `total_supply` view, so the DAO snapshots it at deployment).
    pub fn initialize_dao(
        env: Env,
        admin: Address,
        gov_token: Address,
        total_supply: i128,
        fee_bps: u64,
        min_stream_duration: u64,
    ) {
        if env.storage().instance().has(&DaoDataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DaoDataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DaoDataKey::GovToken, &gov_token);
        env.storage()
            .instance()
            .set(&DaoDataKey::TotalSupply, &total_supply);
        env.storage().instance().set(
            &DaoDataKey::Params,
            &DaoParams {
                fee_bps,
                min_stream_duration,
            },
        );
        env.storage().instance().set(&DaoDataKey::Activated, &false);
    }

    /// Returns the total governance token supply captured at `initialize`.
    pub fn get_total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DaoDataKey::TotalSupply)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn get_admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn get_gov_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DaoDataKey::GovToken)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn get_params(env: Env) -> DaoParams {
        env.storage()
            .instance()
            .get(&DaoDataKey::Params)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn is_activated(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DaoDataKey::Activated)
            .unwrap_or(false)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        env.storage()
            .persistent()
            .get(&DaoDataKey::Proposal(proposal_id))
            .unwrap_or_else(|| panic!("proposal not found"))
    }

    pub fn get_next_proposal_id(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DaoDataKey::NextProposalId)
            .unwrap_or(0)
    }

    /// Switches the contract into DAO mode. Only the admin can activate, and
    /// only before activation. After activation, admin changes require a DAO
    /// proposal (see [`Self::set_admin`]).
    pub fn activate(env: Env, admin: Address) {
        require_admin(&env, &admin);
        admin.require_auth();
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DaoDataKey::Activated)
            .unwrap_or(false)
        {
            panic!("already activated");
        }
        env.storage().instance().set(&DaoDataKey::Activated, &true);
    }

    /// Direct admin transfer. Allowed only while the DAO is not yet activated;
    /// afterwards admin changes must go through an `Admin` proposal.
    pub fn set_dao_admin(env: Env, admin: Address, new_admin: Address) {
        require_admin(&env, &admin);
        admin.require_auth();
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DaoDataKey::Activated)
            .unwrap_or(false)
        {
            panic!("admin changes require DAO proposal");
        }
        env.storage().instance().set(&DaoDataKey::Admin, &new_admin);
    }

    /// Creates a proposal. Any authenticated account may propose; the outcome
    /// is decided by token-weighted voting. Returns the new proposal ID.
    pub fn create_proposal(env: Env, proposer: Address, target: ProposalTarget) -> u64 {
        require_activated(&env);
        proposer.require_auth();

        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&DaoDataKey::NextProposalId)
            .unwrap_or(0);
        next_id += 1;

        let now = env.ledger().timestamp();
        let proposal = Proposal {
            id: next_id,
            target: target.clone(),
            proposer: proposer.clone(),
            created_at: now,
            votes_for: 0,
            votes_against: 0,
            executed: false,
        };

        env.storage()
            .persistent()
            .set(&DaoDataKey::NextProposalId, &next_id);
        env.storage()
            .persistent()
            .set(&DaoDataKey::Proposal(next_id), &proposal);

        let voting_end = now.saturating_add(VOTING_PERIOD_SECONDS);
        env.events().publish(
            (symbol_short!("Proposal"), symbol_short!("Created")),
            ProposalCreated {
                proposal_id: next_id,
                proposer,
                target,
                voting_end,
                timestamp: now,
            },
        );

        next_id
    }

    /// Casts a vote on a proposal. Voting weight equals the voter's governance
    /// token balance at the time of voting. Each account may vote once.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        require_activated(&env);
        voter.require_auth();

        let mut proposal = get_proposal_or_panic(&env, proposal_id);
        if proposal.executed {
            panic!("proposal already executed");
        }
        let now = env.ledger().timestamp();
        if now > proposal.created_at.saturating_add(VOTING_PERIOD_SECONDS) {
            panic!("voting period ended");
        }

        let mut votes: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&DaoDataKey::ProposalVotes(proposal_id))
            .unwrap_or_else(|| Map::new(&env));
        if votes.contains_key(voter.clone()) {
            panic!("already voted");
        }

        let gov_token = env
            .storage()
            .instance()
            .get::<_, Address>(&DaoDataKey::GovToken)
            .unwrap_or_else(|| panic!("not initialized"));
        let weight = TokenClient::new(&env, &gov_token).balance(&voter);

        votes.set(voter.clone(), support);
        env.storage()
            .persistent()
            .set(&DaoDataKey::ProposalVotes(proposal_id), &votes);

        if support {
            proposal.votes_for += weight;
        } else {
            proposal.votes_against += weight;
        }
        env.storage()
            .persistent()
            .set(&DaoDataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("Proposal"), symbol_short!("Vote")),
            VoteCast {
                proposal_id,
                voter,
                support,
                weight,
                timestamp: now,
            },
        );
    }

    /// Executes a proposal once voting has ended, quorum is met (>= 10% of
    /// total token supply voted) and the simple majority supports it.
    /// Returns `true` when the proposal was executed.
    pub fn execute(env: Env, proposal_id: u64) -> bool {
        require_activated(&env);

        let mut proposal = get_proposal_or_panic(&env, proposal_id);
        if proposal.executed {
            return false;
        }
        let now = env.ledger().timestamp();
        if now <= proposal.created_at.saturating_add(VOTING_PERIOD_SECONDS) {
            panic!("voting period not ended");
        }

        let total_supply: i128 = env
            .storage()
            .instance()
            .get(&DaoDataKey::TotalSupply)
            .unwrap_or_else(|| panic!("not initialized"));
        let quorum = total_supply.saturating_mul(QUORUM_BPS) / 10_000;
        let total_votes = proposal.votes_for.saturating_add(proposal.votes_against);

        if total_votes < quorum {
            panic!("quorum not met");
        }
        if proposal.votes_for <= proposal.votes_against {
            return false;
        }

        match proposal.target.clone() {
            ProposalTarget::FeeBps(new_fee) => {
                let mut params: DaoParams = env
                    .storage()
                    .instance()
                    .get(&DaoDataKey::Params)
                    .unwrap_or_else(|| panic!("not initialized"));
                params.fee_bps = new_fee;
                env.storage().instance().set(&DaoDataKey::Params, &params);
            }
            ProposalTarget::MinStreamDuration(new_min) => {
                let mut params: DaoParams = env
                    .storage()
                    .instance()
                    .get(&DaoDataKey::Params)
                    .unwrap_or_else(|| panic!("not initialized"));
                params.min_stream_duration = new_min;
                env.storage().instance().set(&DaoDataKey::Params, &params);
            }
            ProposalTarget::Admin(new_admin) => {
                env.storage().instance().set(&DaoDataKey::Admin, &new_admin);
            }
        }

        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&DaoDataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("Proposal"), symbol_short!("Executed")),
            ProposalExecuted {
                proposal_id,
                target: proposal.target.clone(),
                timestamp: now,
            },
        );

        true
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DaoDataKey::Admin)
        .unwrap_or_else(|| panic!("not initialized"))
}

fn require_admin(env: &Env, admin: &Address) {
    let stored = read_admin(env);
    if stored != *admin {
        panic!("unauthorized");
    }
}

fn require_activated(env: &Env) {
    if !env
        .storage()
        .instance()
        .get::<_, bool>(&DaoDataKey::Activated)
        .unwrap_or(false)
    {
        panic!("dao not activated");
    }
}

fn get_proposal_or_panic(env: &Env, proposal_id: u64) -> Proposal {
    env.storage()
        .persistent()
        .get(&DaoDataKey::Proposal(proposal_id))
        .unwrap_or_else(|| panic!("proposal not found"))
}
