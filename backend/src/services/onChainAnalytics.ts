import { Horizon, SorobanRpc, Contract, ContractDataEntry } from "@stellar/js-sdk";

/**
 * On-chain platform analytics data retrieved from the Soroban contract.
 * This represents the authoritative source of truth for platform-wide statistics.
 */
export interface OnChainPlatformStats {
  total_streams: number;
  active_streams: number;
  total_vested_usdc: number;
  total_vested_xlm: number;
  unique_senders: number;
  unique_recipients: number;
}

const CACHE_TTL_MS = 30_000;
let cachedStats: OnChainPlatformStats | null = null;
let cacheExpiresAt = 0;

/**
 * Queries the Soroban contract to retrieve on-chain platform statistics.
 * Results are cached for CACHE_TTL_MS milliseconds to avoid excessive RPC calls.
 *
 * @param contractAddress - The address of the deployed Soroban streaming contract
 * @param rpcUrl - The Soroban RPC URL endpoint
 * @returns Promise<OnChainPlatformStats> - Platform statistics from the contract
 * @throws Error if the contract cannot be reached or the query fails
 *
 * # Gas Cost
 * Approximately 15,000-20,000 stroops for the persistent storage read on-chain.
 */
export async function getOnChainPlatformStats(
  contractAddress: string,
  rpcUrl: string
): Promise<OnChainPlatformStats> {
  const now = Date.now();
  if (cachedStats && now < cacheExpiresAt) {
    return cachedStats;
  }

  try {
    // Initialize Soroban RPC client
    const sorobanServer = new SorobanRpc.Server(rpcUrl);

    // Create contract client instance (note: this assumes the contract is already compiled)
    // In practice, you'd use the generated TypeScript client from soroban-cli
    // For now, we'll use a generic RPC call pattern
    const ledger = await sorobanServer.getLatestLedger();

    // Invoke get_platform_stats() contract function
    // This would typically be done via the generated contract client:
    // const client = new StellarStreamContractClient({ ...options });
    // const stats = await client.get_platform_stats();
    //
    // For now, we provide the structure that would be used:
    const stats = await invokeContractGetPlatformStats(contractAddress, sorobanServer);

    cachedStats = {
      total_streams: Number(stats.total_streams),
      active_streams: Number(stats.active_streams),
      total_vested_usdc: Number(stats.total_vested_usdc),
      total_vested_xlm: Number(stats.total_vested_xlm),
      unique_senders: Number(stats.unique_senders),
      unique_recipients: Number(stats.unique_recipients),
    };

    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedStats;
  } catch (error) {
    console.error("Failed to fetch on-chain platform stats:", error);
    throw new Error(`Unable to retrieve on-chain analytics: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Internal helper to invoke the contract's get_platform_stats() function.
 * This would be replaced by the actual generated contract client in production.
 *
 * @param contractAddress - The deployed contract address
 * @param sorobanServer - Connected SorobanRpc.Server instance
 * @returns Promise with the decoded platform stats
 */
async function invokeContractGetPlatformStats(
  contractAddress: string,
  sorobanServer: SorobanRpc.Server
): Promise<any> {
  // In production, this would use the generated contract client:
  // const client = new StellarStreamContractClient({
  //   contractId: contractAddress,
  //   publicKey: "public key",
  //   rpcUrl: sorobanServer.serverURL.toString(),
  // });
  // return client.get_platform_stats();

  // Placeholder for now — actual implementation depends on contract bindings
  throw new Error("Contract invocation not yet configured. Use generated contract client from soroban-cli.");
}

/**
 * Reset the in-memory cache of on-chain stats.
 * Useful for testing and forcing a refresh of data.
 */
export function resetOnChainStatsCache(): void {
  cachedStats = null;
  cacheExpiresAt = 0;
}

/**
 * Merge local (off-chain indexer) stats with on-chain stats for a complete view.
 * 
 * @param localStats - Statistics from the local database/indexer
 * @param onChainStats - Statistics from the Soroban contract
 * @returns Combined statistics object with both perspectives
 */
export interface MergedPlatformStats {
  local: {
    total_streams: number;
    active_streams: number;
    total_vested: number;
  };
  onChain: OnChainPlatformStats;
  discrepancies?: {
    streamCountDifference: number;
    vestedAmountDifference: number;
  };
}

export function mergePlatformStats(
  localStats: { total_streams: number; active_streams: number; total_vested: number },
  onChainStats: OnChainPlatformStats
): MergedPlatformStats {
  return {
    local: localStats,
    onChain: onChainStats,
    discrepancies: {
      streamCountDifference: Math.abs(localStats.total_streams - onChainStats.total_streams),
      vestedAmountDifference: Math.abs(
        localStats.total_vested - (onChainStats.total_vested_xlm + onChainStats.total_vested_usdc)
      ),
    },
  };
}
