// Generated Soroban contract client for StellarStream
// Source: contracts/src/lib.rs
// Regenerate with: CONTRACT_ID=$(cat contracts/contract_id.txt) npm run gen:bindings

import {
  SorobanRpc,
  Contract,
  TransactionBuilder,
  Networks,
  Address,
  xdr,
  rpc,
} from "@stellar/stellar-sdk";
import * as Types from "./types";
import { ContractMethods, createContractMethods } from "./methods";

// ============================================================================
// Contract Client Configuration
// ============================================================================

export interface ContractConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

// ============================================================================
// Contract Client Class
// ============================================================================

/**
 * StellarStream Contract Client
 * 
 * Provides typed access to the StellarStream Soroban contract.
 * Read-only methods use RPC simulation. Write methods return transaction XDR
 * for wallet signing (e.g., with Freighter).
 */
export class StellarStreamContract {
  private contract: Contract;
  private rpc: SorobanRpc.Server;
  private networkPassphrase: string;
  private methods: ContractMethods;

  constructor(config: ContractConfig) {
    this.contract = new Contract(config.contractId);
    this.rpc = new SorobanRpc.Server(config.rpcUrl);
    this.networkPassphrase = config.networkPassphrase;
    this.methods = createContractMethods({
      call: async <T>(method: string, args: unknown[]): Promise<T> => {
        throw new Error(
          `Direct contract call to ${method} requires wallet signing. ` +
          `Use simulateCall for read-only methods or buildTransaction for write methods.`
        );
      },
      simulate: async <T>(method: string, args: unknown[]): Promise<{ result: T }> => {
        // Build a simulation transaction
        const sourceAccount = new xdr.AccountId(
          xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
        );
        
        const tx = new TransactionBuilder(sourceAccount, {
          fee: "1000000",
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(this.contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const result = await this.rpc.simulateTransaction(tx);
        
        if (rpc.Api.isSimulationError(result)) {
          throw new Error(`Simulation failed: ${result.error}`);
        }
        
        if (!result.result?.retval) {
          throw new Error(`No return value from simulation`);
        }
        
        return { result: result.result.retval.toJSON() as T };
      },
    });
  }

  // ============================================================================
  // Read-only methods (via simulation)
  // ============================================================================

  /** Get a stream by ID */
  async getStream(streamId: bigint): Promise<Types.Stream> {
    const result = await this.methods.getStream({ stream_id: streamId });
    return result;
  }

  /** Get the next stream ID to be assigned */
  async getNextStreamId(): Promise<bigint> {
    const result = await this.methods.getNextStreamId();
    return result;
  }

  /** Get total stream count */
  async getStreamCount(): Promise<bigint> {
    const result = await this.methods.getStreamCount();
    return result;
  }

  /** Get claimable amount for a stream at a specific time */
  async claimable(streamId: bigint, atTime: bigint): Promise<bigint> {
    const result = await this.methods.claimable({ stream_id: streamId, at_time: atTime });
    return result;
  }

  /** Get claimable amounts for multiple streams at a specific time */
  async getClaimableBatch(streamIds: bigint[], atTime: bigint): Promise<Map<bigint, bigint>> {
    const result = await this.methods.getClaimableBatch({ stream_ids: streamIds, at_time: atTime });
    return result;
  }

  // ============================================================================
  // Write methods (return transaction XDR for wallet signing)
  // ============================================================================

  /**
   * Build a create_stream transaction.
   * Returns transaction XDR to be signed by the sender's wallet.
   */
  async buildCreateStreamTransaction(args: Types.CreateStreamArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("create_stream", 
        args.sender,
        args.recipient,
        args.token,
        args.total_amount,
        args.start_time,
        args.end_time,
        args.cliff_seconds,
        args.metadata ?? null
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  /**
   * Build a claim transaction.
   * Returns transaction XDR to be signed by the recipient's wallet.
   */
  async buildClaimTransaction(args: Types.ClaimArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("claim",
        args.stream_id,
        args.recipient,
        args.amount
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  /**
   * Build a cancel transaction.
   * Returns transaction XDR to be signed by the sender's wallet.
   */
  async buildCancelTransaction(args: Types.CancelArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("cancel",
        args.stream_id,
        args.sender
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  /**
   * Build a pause_stream transaction.
   * Returns transaction XDR to be signed by the sender's wallet.
   */
  async buildPauseStreamTransaction(args: Types.PauseStreamArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("pause_stream",
        args.stream_id,
        args.sender
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  /**
   * Build a resume_stream transaction.
   * Returns transaction XDR to be signed by the sender's wallet.
   */
  async buildResumeStreamTransaction(args: Types.ResumeStreamArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("resume_stream",
        args.stream_id,
        args.sender
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  // ============================================================================
  // Admin methods
  // ============================================================================

  async buildInitializeTransaction(args: Types.InitializeArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("initialize",
        args.admin,
        args.native_token,
        args.allowed_tokens
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  async buildClawbackTransaction(args: Types.ClawbackArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("clawback",
        args.stream_id,
        args.amount,
        args.admin
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  async buildAddAllowedTokenTransaction(args: Types.AddAllowedTokenArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("add_allowed_token",
        args.admin,
        args.token
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  async buildRemoveAllowedTokenTransaction(args: Types.RemoveAllowedTokenArgs): Promise<string> {
    const sourceAccount = new xdr.AccountId(
      xdr.PublicKey.publicKeyTypeEd25519(new Uint8Array(32))
    );
    
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("remove_allowed_token",
        args.admin,
        args.token
      ))
      .setTimeout(300)
      .build();

    return tx.toXDR();
  }

  // ============================================================================
  // Utility methods
  // ============================================================================

  getContractId(): string {
    return this.contract.contractId();
  }

  getRpcUrl(): string {
    return this.rpc.serverUrl;
  }

  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }
}

// ============================================================================
// Default export for backward compatibility
// ============================================================================

export { StellarStreamContract as Contract };

// Re-export all types
export * from "./types";
export * from "./methods";