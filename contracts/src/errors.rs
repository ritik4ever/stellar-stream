use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum ContractError {
    /// Attempted to claim when no tokens are available or vested amount is zero.
    InsufficientVested = 1,
    /// Unauthorized claim attempt.
    Unauthorized = 2,
    /// Escrow has expired or was revoked.
    EscrowInactive = 3,
    /// Condition already satisfied.
    ConditionAlreadySatisfied = 4,
    /// Invalid condition index.
    InvalidConditionIndex = 5,
    /// Timeout not yet expired.
    TimeoutNotExpired = 6,
    /// Emergency release disabled.
    EmergencyReleaseDisabled = 7,
}
