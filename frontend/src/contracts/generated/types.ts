// TypeScript types generated from StellarStream Soroban contract
// Source: contracts/src/lib.rs

// ============================================================================
// Primitive type mappings
// ============================================================================

export type Address = string;
export type U64 = bigint;
export type I128 = bigint;
export type U32 = number;
export type String = string;
export type Map<K, V> = Map<K, V>;
export type Vec<T> = T[];
export type Option<T> = T | null | undefined;

// ============================================================================
// Contract Types (from Stream struct)
// ============================================================================

export interface Stream {
  sender: Address;
  recipient: Address;
  token: Address;
  total_amount: I128;
  claimed_amount: I128;
  start_time: U64;
  end_time: U64;
  cliff_seconds: U64;
  canceled: boolean;
  paused: boolean;
  pause_started_at: Option<U64>;
  metadata: Option<Map<String, String>>;
}

// ============================================================================
// Event Types
// ============================================================================

export interface StreamCreated {
  stream_id: U64;
  sender: Address;
  recipient: Address;
  token: Address;
  token_symbol: String;
  total_amount: I128;
  start_time: U64;
  end_time: U64;
  cliff_seconds: U64;
  metadata: Option<Map<String, String>>;
}

export interface StreamClaimed {
  stream_id: U64;
  recipient: Address;
  amount: I128;
}

export interface StreamCanceled {
  stream_id: U64;
  sender: Address;
}

export interface StreamPaused {
  stream_id: U64;
  sender: Address;
  paused_at: U64;
}

export interface StreamResumed {
  stream_id: U64;
  sender: Address;
  resumed_at: U64;
}

export interface ClawbackExecuted {
  stream_id: U64;
  amount: I128;
  recipient: Address;
}

export interface StreamTransferred {
  stream_id: U64;
  old_recipient: Address;
  new_recipient: Address;
}

// ============================================================================
// Method Argument Types
// ============================================================================

export interface InitializeArgs {
  admin: Address;
  native_token: Address;
  allowed_tokens: Address[];
}

export interface CreateStreamArgs {
  sender: Address;
  recipient: Address;
  token: Address;
  total_amount: I128;
  start_time: U64;
  end_time: U64;
  cliff_seconds: U64;
  metadata?: Map<String, String>;
}

export interface CreateSplitStreamArgs {
  sender: Address;
  token: Address;
  total_amount: I128;
  start_time: U64;
  end_time: U64;
  recipients: [Address, I128][];
}

export interface GetSplitChildrenArgs {
  parent_stream_id: U64;
}

export interface GetStreamArgs {
  stream_id: U64;
}

export interface ClaimableArgs {
  stream_id: U64;
  at_time: U64;
}

export interface GetClaimableBatchArgs {
  stream_ids: U64[];
  at_time: U64;
}

export interface ClaimArgs {
  stream_id: U64;
  recipient: Address;
  amount: I128;
}

export interface CancelArgs {
  stream_id: U64;
  sender: Address;
}

export interface TransferStreamArgs {
  stream_id: U64;
  new_recipient: Address;
}

export interface PauseStreamArgs {
  stream_id: U64;
  sender: Address;
}

export interface ResumeStreamArgs {
  stream_id: U64;
  sender: Address;
}

export interface ClawbackArgs {
  stream_id: U64;
  amount: I128;
  admin: Address;
}

export interface AddAllowedTokenArgs {
  admin: Address;
  token: Address;
}

export interface RemoveAllowedTokenArgs {
  admin: Address;
  token: Address;
}

// ============================================================================
// Method Result Types
// ============================================================================

export type InitializeResult = void;
export type CreateStreamResult = U64;
export type CreateSplitStreamResult = U64;
export type GetSplitChildrenResult = U64[];
export type GetStreamResult = Stream;
export type GetNextStreamIdResult = U64;
export type GetStreamCountResult = U64;
export type ClaimableResult = I128;
export type GetClaimableBatchResult = Map<U64, I128>;
export type ClaimResult = I128;
export type CancelResult = void;
export type TransferStreamResult = void;
export type PauseStreamResult = void;
export type ResumeStreamResult = void;
export type ClawbackResult = I128;
export type AddAllowedTokenResult = void;
export type RemoveAllowedTokenResult = void;