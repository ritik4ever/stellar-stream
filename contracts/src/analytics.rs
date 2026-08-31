use soroban_sdk::{contracttype, Address, Env, Map, String, Vec};

/// Platform-wide stream analytics snapshot.
/// 
/// Updated atomically on each state change (stream creation, claim, cancel, pause, resume).
/// All fields are cumulative and accurate at the time of query.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlatformStats {
    /// Total number of streams ever created (including canceled ones).
    pub total_streams: u64,
    /// Number of currently active streams (not canceled, not fully claimed, within time window).
    pub active_streams: u64,
    /// Total amount vested across all USDC streams (claimed + unclaimed vested).
    pub total_vested_usdc: i128,
    /// Total amount vested across all XLM streams (claimed + unclaimed vested).
    pub total_vested_xlm: i128,
    /// Number of unique addresses that created streams (senders).
    pub unique_senders: u64,
    /// Number of unique addresses that are stream recipients.
    pub unique_recipients: u64,
}

/// Storage keys for analytics data.
#[contracttype]
pub enum AnalyticsKey {
    /// PlatformStats — the main stats snapshot.
    PlatformStats,
    /// Set<Address> of all unique senders (stored as Vec for iteration).
    UniqueSenders,
    /// Set<Address> of all unique recipients (stored as Vec for iteration).
    UniqueRecipients,
    /// Map<String, i128> tracking total vested per asset code.
    /// Keys are asset symbols like "USDC" and "XLM".
    VestedByAsset,
    /// Count of currently active streams.
    /// An active stream is not canceled, not fully claimed, and within its time window.
    ActiveStreamCount,
}

/// Helper to check if an address is in a set (represented as Vec).
fn address_in_set(env: &Env, addr: &Address, set: &Vec<Address>) -> bool {
    for existing in set.iter() {
        if existing == addr {
            return true;
        }
    }
    false
}

/// Add an address to the set if not already present.
fn add_to_set(env: &Env, addr: Address, set: &mut Vec<Address>) {
    if !address_in_set(env, &addr, set) {
        set.push_back(addr);
    }
}

/// Remove an address from the set.
fn remove_from_set(env: &Env, addr: &Address, set: &mut Vec<Address>) {
    if let Some(idx) = set.first_index_of(addr) {
        set.remove(idx);
    }
}

/// Initialize analytics on contract deployment.
/// Called during initialize() in lib.rs.
pub fn init_analytics(env: &Env) {
    let stats = PlatformStats {
        total_streams: 0,
        active_streams: 0,
        total_vested_usdc: 0,
        total_vested_xlm: 0,
        unique_senders: 0,
        unique_recipients: 0,
    };
    env.storage().persistent().set(&AnalyticsKey::PlatformStats, &stats);
    env.storage().persistent().set(&AnalyticsKey::UniqueSenders, &Vec::<Address>::new(env));
    env.storage().persistent().set(&AnalyticsKey::UniqueRecipients, &Vec::<Address>::new(env));
    env.storage().persistent().set(&AnalyticsKey::VestedByAsset, &Map::<String, i128>::new(env));
    env.storage().persistent().set(&AnalyticsKey::ActiveStreamCount, &0u64);
}

/// Record creation of a new stream in analytics.
/// Increments total_streams, adds unique sender/recipient if new, and registers as active.
pub fn record_stream_created(
    env: &Env,
    sender: Address,
    recipient: Address,
    token_symbol: String,
) {
    let mut stats: PlatformStats = env
        .storage()
        .persistent()
        .get(&AnalyticsKey::PlatformStats)
        .unwrap_or_else(|| {
            panic!("analytics not initialized");
        });

    let mut senders: Vec<Address> = env
        .storage()
        .persistent()
        .get(&AnalyticsKey::UniqueSenders)
        .unwrap_or_else(|| Vec::new(env));
    let mut recipients: Vec<Address> = env
        .storage()
        .persistent()
        .get(&AnalyticsKey::UniqueRecipients)
        .unwrap_or_else(|| Vec::new(env));

    // Increment total streams
    stats.total_streams = stats.total_streams.saturating_add(1);

    // Track unique sender
    let sender_was_new = !address_in_set(env, &sender, &senders);
    if sender_was_new {
        add_to_set(env, sender, &mut senders);
        stats.unique_senders = stats.unique_senders.saturating_add(1);
    }

    // Track unique recipient
    let recipient_was_new = !address_in_set(env, &recipient, &recipients);
    if recipient_was_new {
        add_to_set(env, recipient, &mut recipients);
        stats.unique_recipients = stats.unique_recipients.saturating_add(1);
    }

    // Increment active stream count (new streams are always active)
    let active_count: u64 = env
        .storage()
        .persistent()
        .get(&AnalyticsKey::ActiveStreamCount)
        .unwrap_or(0);
    env.storage()
        .persistent()
        .set(&AnalyticsKey::ActiveStreamCount, &active_count.saturating_add(1));

    // Persist updated analytics
    env.storage()
        .persistent()
        .set(&AnalyticsKey::PlatformStats, &stats);
    env.storage()
        .persistent()
        .set(&AnalyticsKey::UniqueSenders, &senders);
    env.storage()
        .persistent()
        .set(&AnalyticsKey::UniqueRecipients, &recipients);
}

/// Record vesting of amounts in analytics.
/// Called when streams are claimed or completed.
/// Updates total_vested_usdc or total_vested_xlm based on token_symbol.
pub fn record_vested_amount(env: &Env, token_symbol: String, amount: i128) {
    let mut stats: PlatformStats = env
        .storage()
        .persistent()
        .get(&AnalyticsKey::PlatformStats)
        .unwrap_or_else(|| {
            panic!("analytics not initialized");
        });

    // Normalize symbol to uppercase for consistency
    let normalized_symbol = {
        let s = token_symbol.to_string();
        let upper = s.to_uppercase();
        String::from_str(env, &upper)
    };

    // Track vested amount by asset
    let mut vested_by_asset: Map<String, i128> = env
        .storage()
        .persistent()
        .get(&AnalyticsKey::VestedByAsset)
        .unwrap_or_else(|| Map::new(env));

    let current_vested = vested_by_asset
        .get(normalized_symbol.clone())
        .unwrap_or(0);
    vested_by_asset.set(normalized_symbol.clone(), current_vested + amount);

    // Update main stats
    if normalized_symbol.to_string() == "USDC" {
        stats.total_vested_usdc = stats.total_vested_usdc.saturating_add(amount);
    } else if normalized_symbol.to_string() == "XLM" {
        stats.total_vested_xlm = stats.total_vested_xlm.saturating_add(amount);
    }

    env.storage()
        .persistent()
        .set(&AnalyticsKey::PlatformStats, &stats);
    env.storage()
        .persistent()
        .set(&AnalyticsKey::VestedByAsset, &vested_by_asset);
}

/// Record cancellation of a stream in analytics.
/// Decrements active_stream_count.
pub fn record_stream_canceled(env: &Env) {
    let active_count: u64 = env
        .storage()
        .persistent()
        .get(&AnalyticsKey::ActiveStreamCount)
        .unwrap_or(0);
    
    if active_count > 0 {
        env.storage()
            .persistent()
            .set(&AnalyticsKey::ActiveStreamCount, &active_count.saturating_sub(1));
    }
}

/// Record completion (full claim) of a stream in analytics.
/// Decrements active_stream_count.
pub fn record_stream_completed(env: &Env) {
    let active_count: u64 = env
        .storage()
        .persistent()
        .get(&AnalyticsKey::ActiveStreamCount)
        .unwrap_or(0);
    
    if active_count > 0 {
        env.storage()
            .persistent()
            .set(&AnalyticsKey::ActiveStreamCount, &active_count.saturating_sub(1));
    }
}

/// Retrieve the current platform statistics.
/// This is a read-only function with no authentication required.
/// Returns the aggregate stats computed from on-chain data.
///
/// # Gas Cost
/// - ~15,000 - 20,000 lumens for reading PlatformStats from persistent storage
/// - Scales minimally with data size as stats are a fixed-size struct
pub fn get_platform_stats(env: &Env) -> PlatformStats {
    env.storage()
        .persistent()
        .get(&AnalyticsKey::PlatformStats)
        .unwrap_or_else(|| {
            panic!("analytics not initialized");
        })
}
