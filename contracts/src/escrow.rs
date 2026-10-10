use soroban_sdk::{contracttype, Address, Env, Map, String, Vec};
use super::errors::ContractError;

// ---------------------------------------------------------------------------
// Condition Types
// ---------------------------------------------------------------------------

/// Types of release conditions that can be applied to an escrow
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConditionType {
    /// Milestone approval by oracle
    Milestone,
    /// KYC verification by oracle
    Kyc,
    /// Admin whitelist approval
    AdminWhitelist,
}

/// Represents a specific release condition with its metadata
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReleaseCondition {
    /// The type of condition
    pub condition_type: ConditionType,
    /// Whether this condition has been met
    pub satisfied: bool,
    /// Timestamp when condition was satisfied (0 if not satisfied)
    pub satisfied_at: u64,
    /// Additional condition-specific metadata
    pub metadata: Map<String, String>,
}

/// Configuration for the escrow timeout mechanism
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowTimeoutConfig {
    /// Timeout period in seconds (default: 90 days = 7,776,000 seconds)
    pub timeout_seconds: u64,
    /// Whether emergency release is enabled
    pub emergency_release_enabled: bool,
}

impl Default for EscrowTimeoutConfig {
    fn default() -> Self {
        Self {
            timeout_seconds: 7_776_000, // 90 days in seconds
            emergency_release_enabled: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Escrow Data Structures
// ---------------------------------------------------------------------------

/// Main escrow structure holding locked funds with release conditions
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Escrow {
    /// Unique escrow ID
    pub escrow_id: u64,
    /// Address that locked the funds
    pub sender: Address,
    /// Address that will receive the funds upon release
    pub recipient: Address,
    /// Token contract address
    pub token: Address,
    /// Total amount locked in escrow
    pub total_amount: i128,
    /// Amount already released to recipient
    pub released_amount: i128,
    /// Timestamp when escrow was created
    pub created_at: u64,
    /// Address of the condition oracle (can confirm conditions)
    pub oracle: Address,
    /// Release conditions that must be met
    pub conditions: Vec<ReleaseCondition>,
    /// Timeout configuration
    pub timeout_config: EscrowTimeoutConfig,
    /// Whether escrow has been emergency released
    pub emergency_released: bool,
    /// Whether escrow has been canceled
    pub canceled: bool,
    /// Additional metadata
    pub metadata: Map<String, String>,
}

/// Storage keys for escrow-related data
#[contracttype]
pub enum EscrowDataKey {
    /// Next escrow ID counter
    NextEscrowId,
    /// Escrow by ID
    Escrow(u64),
    /// Condition satisfaction status
    ConditionStatus(u64, u32), // escrow_id, condition_index
}

// ---------------------------------------------------------------------------
// Escrow Events
// ---------------------------------------------------------------------------

/// Emitted when a new escrow is created
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowCreated {
    pub escrow_id: u64,
    pub actor: Address,
    pub timestamp: u64,
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub total_amount: i128,
    pub oracle: Address,
}

/// Emitted when a condition is satisfied
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConditionSatisfied {
    pub escrow_id: u64,
    pub condition_index: u32,
    pub condition_type: ConditionType,
    pub actor: Address,
    pub timestamp: u64,
}

/// Emitted when funds are released from escrow
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowReleased {
    pub escrow_id: u64,
    pub actor: Address,
    pub timestamp: u64,
    pub recipient: Address,
    pub amount: i128,
}

/// Emitted when emergency release is executed
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmergencyReleaseExecuted {
    pub escrow_id: u64,
    pub actor: Address,
    pub timestamp: u64,
    pub recipient: Address,
    pub amount: i128,
}

/// Emitted when escrow is canceled
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowCanceled {
    pub escrow_id: u64,
    pub actor: Address,
    pub timestamp: u64,
    pub refunded_amount: i128,
}

// ---------------------------------------------------------------------------
// Escrow Implementation
// ---------------------------------------------------------------------------

pub struct EscrowModule;

impl EscrowModule {
    /// Create a new escrow with conditional release
    pub fn create_escrow(
        env: &Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        oracle: Address,
        conditions: Vec<ReleaseCondition>,
        timeout_config: EscrowTimeoutConfig,
        metadata: Map<String, String>,
    ) -> u64 {
        // Validation
        if total_amount <= 0 {
            panic!("total_amount must be positive");
        }
        if conditions.is_empty() {
            panic!("at least one condition required");
        }

        // Generate escrow ID
        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&EscrowDataKey::NextEscrowId)
            .unwrap_or(0);
        next_id += 1;

        let now = env.ledger().timestamp();

        // Create escrow
        let escrow = Escrow {
            escrow_id: next_id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            total_amount,
            released_amount: 0,
            created_at: now,
            oracle: oracle.clone(),
            conditions: conditions.clone(),
            timeout_config,
            emergency_released: false,
            canceled: false,
            metadata,
        };

        // Store escrow
        env.storage()
            .persistent()
            .set(&EscrowDataKey::Escrow(next_id), &escrow);
        env.storage()
            .persistent()
            .set(&EscrowDataKey::NextEscrowId, &next_id);

        // Store individual condition statuses
        for (index, condition) in conditions.iter().enumerate() {
            env.storage()
                .persistent()
                .set(&EscrowDataKey::ConditionStatus(next_id, index as u32), &condition);
        }

        next_id
    }

    /// Get escrow by ID
    pub fn get_escrow(env: &Env, escrow_id: u64) -> Escrow {
        env.storage()
            .persistent()
            .get(&EscrowDataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"))
    }

    /// Check if all conditions are satisfied
    pub fn all_conditions_satisfied(env: &Env, escrow_id: u64) -> bool {
        let escrow = Self::get_escrow(env, escrow_id);
        
        for (_index, condition) in escrow.conditions.iter().enumerate() {
            if !condition.satisfied {
                return false;
            }
        }
        true
    }

    /// Satisfy a condition (only callable by oracle)
    pub fn satisfy_condition(
        env: &Env,
        escrow_id: u64,
        condition_index: u32,
        oracle: Address,
    ) -> Result<(), ContractError> {
        // Get escrow
        let mut escrow = Self::get_escrow(env, escrow_id);
        
        // Validate oracle
        if escrow.oracle != oracle {
            return Err(ContractError::Unauthorized);
        }
        oracle.require_auth();

        // Validate condition index
        if condition_index >= escrow.conditions.len() {
            return Err(ContractError::InvalidConditionIndex);
        }

        // Check if already satisfied
        if escrow.conditions.get(condition_index).unwrap().satisfied {
            return Err(ContractError::ConditionAlreadySatisfied);
        }

        // Update condition status
        let mut condition = escrow.conditions.get(condition_index).unwrap();
        condition.satisfied = true;
        condition.satisfied_at = env.ledger().timestamp();
        escrow.conditions.set(condition_index, condition.clone());

        // Store updated condition
        env.storage()
            .persistent()
            .set(&EscrowDataKey::ConditionStatus(escrow_id, condition_index), &condition);
        
        // Store updated escrow
        env.storage()
            .persistent()
            .set(&EscrowDataKey::Escrow(escrow_id), &escrow);

        Ok(())
    }

    /// Check if timeout has expired
    pub fn is_timeout_expired(env: &Env, escrow_id: u64) -> bool {
        let escrow = Self::get_escrow(env, escrow_id);
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(escrow.created_at);
        elapsed >= escrow.timeout_config.timeout_seconds
    }

    /// Release funds when all conditions are satisfied
    pub fn release_funds(
        env: &Env,
        escrow_id: u64,
        recipient: Address,
    ) -> Result<i128, ContractError> {
        let mut escrow = Self::get_escrow(env, escrow_id);

        // Validate recipient
        if escrow.recipient != recipient {
            return Err(ContractError::Unauthorized);
        }
        recipient.require_auth();

        // Check if escrow is canceled or emergency released
        if escrow.canceled || escrow.emergency_released {
            return Err(ContractError::EscrowInactive);
        }

        // Check if all conditions are satisfied
        if !Self::all_conditions_satisfied(env, escrow_id) {
            return Err(ContractError::EscrowInactive);
        }

        // Calculate releasable amount
        let releasable_amount = escrow.total_amount - escrow.released_amount;
        if releasable_amount <= 0 {
            return Err(ContractError::InsufficientVested);
        }

        // Transfer tokens
        let contract_address = env.current_contract_address();
        let token_client = soroban_sdk::token::Client::new(env, &escrow.token);
        token_client.transfer(&contract_address, &recipient, &releasable_amount);

        // Update escrow state
        escrow.released_amount = escrow.total_amount;
        env.storage()
            .persistent()
            .set(&EscrowDataKey::Escrow(escrow_id), &escrow);

        Ok(releasable_amount)
    }

    /// Emergency release by admin after timeout
    pub fn emergency_release(
        env: &Env,
        escrow_id: u64,
        admin: Address,
    ) -> Result<i128, ContractError> {
        // Validate admin (reusing the main contract's admin)
        let admin_stored: Address = env
            .storage()
            .instance()
            .get(&crate::DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        
        if admin_stored != admin {
            return Err(ContractError::Unauthorized);
        }
        admin.require_auth();

        let mut escrow = Self::get_escrow(env, escrow_id);

        // Check if timeout has expired
        if !Self::is_timeout_expired(env, escrow_id) {
            return Err(ContractError::EscrowInactive);
        }

        // Check if emergency release is enabled
        if !escrow.timeout_config.emergency_release_enabled {
            return Err(ContractError::EscrowInactive);
        }

        // Check if already released
        if escrow.emergency_released || escrow.canceled {
            return Err(ContractError::EscrowInactive);
        }

        // Calculate releasable amount
        let releasable_amount = escrow.total_amount - escrow.released_amount;
        if releasable_amount <= 0 {
            return Err(ContractError::InsufficientVested);
        }

        // Transfer tokens to recipient
        let contract_address = env.current_contract_address();
        let token_client = soroban_sdk::token::Client::new(env, &escrow.token);
        token_client.transfer(&contract_address, &escrow.recipient, &releasable_amount);

        // Update escrow state
        escrow.emergency_released = true;
        escrow.released_amount = escrow.total_amount;
        env.storage()
            .persistent()
            .set(&EscrowDataKey::Escrow(escrow_id), &escrow);

        Ok(releasable_amount)
    }

    /// Cancel escrow and refund sender
    pub fn cancel_escrow(
        env: &Env,
        escrow_id: u64,
        sender: Address,
    ) -> Result<i128, ContractError> {
        let mut escrow = Self::get_escrow(env, escrow_id);

        // Validate sender
        if escrow.sender != sender {
            return Err(ContractError::Unauthorized);
        }
        sender.require_auth();

        // Check if already canceled or released
        if escrow.canceled || escrow.emergency_released {
            return Err(ContractError::EscrowInactive);
        }

        // Calculate refund amount (total - released)
        let refund_amount = escrow.total_amount - escrow.released_amount;
        if refund_amount <= 0 {
            return Err(ContractError::InsufficientVested);
        }

        // Transfer refund to sender
        let contract_address = env.current_contract_address();
        let token_client = soroban_sdk::token::Client::new(env, &escrow.token);
        token_client.transfer(&contract_address, &sender, &refund_amount);

        // Update escrow state
        escrow.canceled = true;
        env.storage()
            .persistent()
            .set(&EscrowDataKey::Escrow(escrow_id), &escrow);

        Ok(refund_amount)
    }

    /// Get the releasable amount for an escrow
    pub fn get_releasable_amount(env: &Env, escrow_id: u64) -> i128 {
        let escrow = Self::get_escrow(env, escrow_id);
        
        if escrow.canceled || escrow.emergency_released {
            return 0;
        }

        if Self::all_conditions_satisfied(env, escrow_id) {
            escrow.total_amount - escrow.released_amount
        } else {
            0
        }
    }

    /// Get escrow conditions status
    pub fn get_conditions_status(env: &Env, escrow_id: u64) -> Vec<ReleaseCondition> {
        let escrow = Self::get_escrow(env, escrow_id);
        escrow.conditions
    }
}