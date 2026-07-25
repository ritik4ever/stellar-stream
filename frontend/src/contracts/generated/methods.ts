// Generated contract method wrappers for StellarStream
// Source: contracts/src/lib.rs

import type * as Types from "./types";

export interface ContractMethods {
  initialize(args: Types.InitializeArgs): Promise<Types.InitializeResult>;
  createStream(args: Types.CreateStreamArgs): Promise<Types.CreateStreamResult>;
  createSplitStream(args: Types.CreateSplitStreamArgs): Promise<Types.CreateSplitStreamResult>;
  getSplitChildren(args: Types.GetSplitChildrenArgs): Promise<Types.GetSplitChildrenResult>;
  getStream(args: Types.GetStreamArgs): Promise<Types.GetStreamResult>;
  getNextStreamId(): Promise<Types.GetNextStreamIdResult>;
  getStreamCount(): Promise<Types.GetStreamCountResult>;
  claimable(args: Types.ClaimableArgs): Promise<Types.ClaimableResult>;
  getClaimableBatch(args: Types.GetClaimableBatchArgs): Promise<Types.GetClaimableBatchResult>;
  claim(args: Types.ClaimArgs): Promise<Types.ClaimResult>;
  cancel(args: Types.CancelArgs): Promise<Types.CancelResult>;
  transferStream(args: Types.TransferStreamArgs): Promise<Types.TransferStreamResult>;
  pauseStream(args: Types.PauseStreamArgs): Promise<Types.PauseStreamResult>;
  resumeStream(args: Types.ResumeStreamArgs): Promise<Types.ResumeStreamResult>;
  clawback(args: Types.ClawbackArgs): Promise<Types.ClawbackResult>;
  addAllowedToken(args: Types.AddAllowedTokenArgs): Promise<Types.AddAllowedTokenResult>;
  removeAllowedToken(args: Types.RemoveAllowedTokenArgs): Promise<Types.RemoveAllowedTokenResult>;
}

export interface ContractMethodCaller {
  call<T>(method: string, args: unknown[]): Promise<T>;
  simulate<T>(method: string, args: unknown[]): Promise<{ result: T }>;
}

export function createContractMethods(caller: ContractMethodCaller): ContractMethods {
  const call = caller.call.bind(caller);
  const simulate = caller.simulate.bind(caller);

  return {
    async initialize(args: Types.InitializeArgs) {
      return call("initialize", [
        args.admin,
        args.native_token,
        args.allowed_tokens,
      ]);
    },

    async createStream(args: Types.CreateStreamArgs) {
      return simulate("create_stream", [
        args.sender,
        args.recipient,
        args.token,
        args.total_amount,
        args.start_time,
        args.end_time,
        args.cliff_seconds,
        args.metadata ?? null,
      ]);
    },

    async createSplitStream(args: Types.CreateSplitStreamArgs) {
      return call("create_split_stream", [
        args.sender,
        args.token,
        args.total_amount,
        args.start_time,
        args.end_time,
        args.recipients,
      ]);
    },

    async getSplitChildren(args: Types.GetSplitChildrenArgs) {
      return simulate("get_split_children", [args.parent_stream_id]);
    },

    async getStream(args: Types.GetStreamArgs) {
      return simulate("get_stream", [args.stream_id]);
    },

    async getNextStreamId() {
      return simulate("get_next_stream_id", []);
    },

    async getStreamCount() {
      return simulate("get_stream_count", []);
    },

    async claimable(args: Types.ClaimableArgs) {
      return simulate("claimable", [args.stream_id, args.at_time]);
    },

    async getClaimableBatch(args: Types.GetClaimableBatchArgs) {
      return simulate("get_claimable_batch", [args.stream_ids, args.at_time]);
    },

    async claim(args: Types.ClaimArgs) {
      return call("claim", [args.stream_id, args.recipient, args.amount]);
    },

    async cancel(args: Types.CancelArgs) {
      return call("cancel", [args.stream_id, args.sender]);
    },

    async transferStream(args: Types.TransferStreamArgs) {
      return call("transfer_stream", [args.stream_id, args.new_recipient]);
    },

    async pauseStream(args: Types.PauseStreamArgs) {
      return call("pause_stream", [args.stream_id, args.sender]);
    },

    async resumeStream(args: Types.ResumeStreamArgs) {
      return call("resume_stream", [args.stream_id, args.sender]);
    },

    async clawback(args: Types.ClawbackArgs) {
      return call("clawback", [args.stream_id, args.amount, args.admin]);
    },

    async addAllowedToken(args: Types.AddAllowedTokenArgs) {
      return call("add_allowed_token", [args.admin, args.token]);
    },

    async removeAllowedToken(args: Types.RemoveAllowedTokenArgs) {
      return call("remove_allowed_token", [args.admin, args.token]);
    },
  };
}