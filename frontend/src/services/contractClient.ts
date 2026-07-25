// StellarStream Contract Client
// Uses generated bindings from frontend/src/contracts/generated

import { StellarStreamContract } from "../contracts/generated";

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? "";
const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org:443";
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

// Create the contract client instance
export const streamContract = CONTRACT_ID
  ? new StellarStreamContract({
      contractId: CONTRACT_ID,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
  : null;

// Export config values for other uses
export { CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE };

// Re-export types for convenience
export type { Stream, CreateStreamArgs, ClaimArgs, CancelArgs } from "../contracts/generated/types";