import { describe, expect, it, vi } from 'vitest';

const { probeRpc, resolveRpcConfig } = require('../../scripts/rpc-preflight.cjs') as {
  probeRpc: (rpcUrl: string, fetchImpl?: typeof fetch) => Promise<void>;
  resolveRpcConfig: (env: Record<string, string>) => {
    network: 'testnet' | 'mainnet';
    rpcUrl: string;
  };
};

describe('RPC deployment preflight', () => {
  it('uses the selected mainnet default when no RPC URL is configured', () => {
    expect(resolveRpcConfig({ STELLAR_NETWORK: 'mainnet' })).toEqual({
      network: 'mainnet',
      rpcUrl: 'https://soroban-rpc.stellar.org:443',
    });
  });

  it('rejects a well-known endpoint from the opposite network', () => {
    expect(() =>
      resolveRpcConfig({
        STELLAR_NETWORK: 'mainnet',
        RPC_URL: 'https://soroban-testnet.stellar.org:443',
      }),
    ).toThrow('RPC_URL does not match STELLAR_NETWORK');
  });

  it('does not misclassify a testnet endpoint when its token contains mainnet', () => {
    expect(
      resolveRpcConfig({
        STELLAR_NETWORK: 'testnet',
        RPC_URL: 'https://rpc.provider.example/route?token=mainnet-secret',
      }),
    ).toEqual({
      network: 'testnet',
      rpcUrl: 'https://rpc.provider.example/route?token=mainnet-secret',
    });
  });

  it('rejects the opposite well-known network passphrase', () => {
    expect(() =>
      resolveRpcConfig({
        STELLAR_NETWORK: 'mainnet',
        NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      }),
    ).toThrow('NETWORK_PASSPHRASE does not match STELLAR_NETWORK');
  });

  it('confirms the RPC accepts an authenticated latest-ledger request', async () => {
    const rpcUrl = 'https://rpc.example/stellar?token=provider-secret';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { latestLedger: { sequence: 123 } } }),
    });

    await expect(probeRpc(rpcUrl, fetchMock)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      rpcUrl,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('getLatestLedger'),
      }),
    );
  });

  it('reports rejected credentials without exposing the RPC URL or token', async () => {
    const rpcUrl = 'https://rpc.example/stellar?token=provider-secret';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    let failure: Error | undefined;
    try {
      await probeRpc(rpcUrl, fetchMock);
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toContain(
      'HTTP 401); verify provider credentials',
    );
    expect(failure?.message).not.toContain('provider-secret');
    expect(failure?.message).not.toContain(rpcUrl);
  });
});