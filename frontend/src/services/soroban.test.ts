import { beforeEach, describe, expect, it, vi } from "vitest";

const getAccount = vi.fn();
const prepareTransaction = vi.fn();
const sendTransaction = vi.fn();
const getTransaction = vi.fn();
const signTransaction = vi.fn();
const contractCall = vi.fn();
const addOperation = vi.fn();
const fromXDR = vi.fn();

const fakePreparedTransaction = {
  toXDR: vi.fn(() => "prepared-claim-xdr"),
};
const fakeSignedTransaction = { kind: "signed-tx" };

vi.mock("@stellar/freighter-api", () => ({
  signTransaction,
}));

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    getAccount = getAccount;
    prepareTransaction = prepareTransaction;
    sendTransaction = sendTransaction;
    getTransaction = getTransaction;
  }

  class MockContract {
    constructor(public contractId: string) {}

    call(method: string, ...args: unknown[]) {
      contractCall(method, ...args);
      return { method, args };
    }
  }

  class MockAddress {
    constructor(private value: string) {}

    toScVal() {
      return { address: this.value };
    }
  }

  class MockTransactionBuilder {
    static fromXDR(xdr: string, networkPassphrase: string) {
      fromXDR(xdr, networkPassphrase);
      return fakeSignedTransaction;
    }

    constructor(
      public sourceAccount: unknown,
      public options: Record<string, unknown>,
    ) {}

    addOperation(operation: unknown) {
      addOperation(operation);
      return this;
    }

    setTimeout() {
      return this;
    }

    build() {
      return { kind: "claim-tx" };
    }
  }

  return {
    Address: MockAddress,
    Contract: MockContract,
    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
    },
    TransactionBuilder: MockTransactionBuilder,
    nativeToScVal: vi.fn((value: unknown, options: unknown) => ({
      value,
      options,
    })),
    rpc: {
      Server: MockServer,
    },
  };
});

describe("claimStream", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv(
      "VITE_CONTRACT_ID",
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
    );
    vi.stubEnv("VITE_RPC_URL", "https://soroban-testnet.stellar.org:443");
    vi.stubEnv(
      "VITE_NETWORK_PASSPHRASE",
      "Test SDF Network ; September 2015",
    );

    getAccount.mockResolvedValue({ accountId: "GRECIPIENT" });
    prepareTransaction.mockResolvedValue(fakePreparedTransaction);
    sendTransaction.mockResolvedValue({ status: "PENDING", hash: "txhash123" });
    getTransaction.mockResolvedValue({ status: "SUCCESS" });
    signTransaction.mockResolvedValue("signed-claim-xdr");

    contractCall.mockClear();
    addOperation.mockClear();
    fromXDR.mockClear();
    fakePreparedTransaction.toXDR.mockClear();
  });

  it("builds a claim transaction, signs with Freighter, and submits it", async () => {
    const { claimStream } = await import("./soroban");

    const response = await claimStream("1", "GRECIPIENT", 500, "USDC");

    expect(contractCall).toHaveBeenCalledWith(
      "claim",
      { value: 1, options: { type: "u64" } },
      { address: "GRECIPIENT" },
      { value: 500n, options: { type: "i128" } },
    );
    expect(fakePreparedTransaction.toXDR).toHaveBeenCalled();
    expect(signTransaction).toHaveBeenCalledWith("prepared-claim-xdr", {
      accountToSign: "GRECIPIENT",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(fromXDR).toHaveBeenCalledWith(
      "signed-claim-xdr",
      "Test SDF Network ; September 2015",
    );
    expect(sendTransaction).toHaveBeenCalledWith(fakeSignedTransaction);
    expect(response.result).toEqual({
      claimedAmount: 500,
      assetCode: "USDC",
      txHash: "txhash123",
    });
  });
});
