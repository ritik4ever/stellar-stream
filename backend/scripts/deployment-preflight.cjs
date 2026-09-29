const { validateEnv } = require('../dist/config/validateEnv');
const { probeRpc } = require('./rpc-preflight.cjs');

async function main() {
  process.env.NODE_ENV = 'production';
  const config = validateEnv();
  await probeRpc(config.rpcUrl);
  console.log(`Deployment preflight passed for ${config.stellarNetwork}.`);
}

main().catch((error) => {
  console.error(`Deployment preflight failed: ${error.message}`);
  process.exitCode = 1;
});