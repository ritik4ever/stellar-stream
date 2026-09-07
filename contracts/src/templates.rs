use soroban_sdk::{contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamTemplate {
    pub id: u64,
    pub sender: Address,
    pub name: String,
    pub token: Address,
    pub duration_seconds: u64,
    pub cliff_seconds: u64,
    pub vesting_type: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemplateCreated {
    pub template_id: u64,
    pub sender: Address,
    pub token: Address,
    pub duration_seconds: u64,
    pub cliff_seconds: u64,
    pub vesting_type: String,
}
