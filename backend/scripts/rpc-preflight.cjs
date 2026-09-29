const fs = require('node:fs');
const { parse } = require('dotenv');

const NETWORKS = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org:443',
    passphrase: 'Test SDF Network ; September 2015',
  },
  mainnet: {
    rpcUrl: 'https://soroban-rpc.stellar.org:443',
    passphrase: 'Public Global Stellar Network ; September 2015',
  },
};

function resolveRpcConfig(env) {
  const rawNetwork = (env.STELLAR_NETWORK || 'testnet').trim().toLowerCase();
  const network = ['testnet', 'test'].includes(rawNetwork)
    ? 'testnet'
    : ['mainnet', 'public', 'main'].includes(rawNetwork)
      ? 'mainnet'
      : null;

  if (!network) {
    throw new Error('STELLAR_NETWORK must be testnet or mainnet.');
  }

  const rpcUrl =
    env.SOROBAN_RPC_URL || env.RPC_URL || NETWORKS[network].rpcUrl;
  let parsedUrl;
  try {
    parsedUrl = new URL(rpcUrl);
  } catch {
    throw new Error('RPC_URL must be a valid http(s) URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('RPC_URL must be a valid http(s) URL.');
  }

  const isMainnetRpc = /mainnet/i.test(parsedUrl.hostname) || rpcUrl === NETWORKS.mainnet.rpcUrl;
  const isTestnetRpc = /testnet/i.test(parsedUrl.hostname);
  if ((network === 'mainnet' && isTestnetRpc) || (network === 'testnet' && isMainnetRpc)) {
    throw new Error('RPC_URL does not match STELLAR_NETWORK.');
  }

  const oppositePassphrase = NETWORKS[network === 'mainnet' ? 'testnet' : 'mainnet'].passphrase;
  if (env.NETWORK_PASSPHRASE === oppositePassphrase) {
    throw new Error('NETWORK_PASSPHRASE does not match STELLAR_NETWORK.');
  }

  return { network, rpcUrl };
}

async function probeRpc(rpcUrl, fetchImpl = globalThis.fetch) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rpcUrl);
  } catch {
    throw new Error('RPC_URL must be a valid http(s) URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('RPC_URL must be a valid http(s) URL.');
  }

  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('RPC connectivity check failed; verify RPC_URL and provider credentials.');
  }

  if (!response.ok) {
    throw new Error(`RPC connectivity check was rejected (HTTP ${response.status}); verify provider credentials.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('RPC endpoint returned an invalid JSON response.');
  }
  if (payload?.error || !Number.isInteger(payload?.result?.latestLedger?.sequence)) {
    throw new Error('RPC endpoint did not return a valid latest-ledger response; verify RPC_URL and provider credentials.');
  }
}

async function main() {
  const envFileIndex = process.argv.indexOf('--env-file');
  const env = envFileIndex >= 0
    ? parse(fs.readFileSync(process.argv[envFileIndex + 1], 'utf8'))
    : process.env;
  const config = resolveRpcConfig(env);
  const skipConnectivity = process.argv.includes('--skip-connectivity');
  if (!skipConnectivity) {
    await probeRpc(config.rpcUrl);
  }
  console.log(`[rpc-preflight] ${config.network} RPC configuration${skipConnectivity ? ' validated' : ' connectivity and credentials verified'}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[rpc-preflight] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { probeRpc, resolveRpcConfig };