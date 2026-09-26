// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { StellarToml } from '@stellar/stellar-sdk';

describe('Stellar SDK TOML parser compatibility', () => {
  it('resolves and parses a stellar.toml file with the patched parser', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/plain');
      response.end('FEDERATION_SERVER = "https://example.org/federation"\n');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const parsed = await StellarToml.Resolver.resolve(`127.0.0.1:${port}`, {
        allowHttp: true,
        timeout: 2000,
      });
      expect(parsed.FEDERATION_SERVER).toBe('https://example.org/federation');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
