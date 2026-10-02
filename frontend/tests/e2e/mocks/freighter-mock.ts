/**
 * E2E-only replacement for `@stellar/freighter-api`.
 *
 * This module is swapped in for the real `@stellar/freighter-api` package
 * ONLY when `VITE_E2E_MOCK_FREIGHTER=true` (see the alias added to
 * `vite.config.ts`), so it is never bundled into a normal dev/prod build.
 *
 * It performs *real* SEP-10 signing with a fixed Testnet keypair, so the
 * backend's genuine challenge-issuance and signature-verification code
 * (`generateChallenge` / `verifyChallengeAndIssueToken` in
 * `backend/src/services/auth.ts`) is exercised exactly as it would be for a
 * real wallet — only the browser extension itself is replaced, not the
 * auth handshake.
 */
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

// Fixed test keypair so the "connected wallet" address is stable across
// runs. This account does NOT need to exist on Horizon: the backend's
// SEP-10 verification (`fetchAccountSigners`) falls back to treating the
// client account itself as the sole required signer when Horizon has no
// record of it (e.g. a 404 for an unfunded/non-existent account).
//
// Override via VITE_E2E_TEST_SECRET if you want to point this at a funded
// testnet account instead.
const TEST_SECRET =
  (import.meta as any).env?.VITE_E2E_TEST_SECRET ??
  "SBZ4WWV2G6ILFZQM4RE7O7JR32TPX2CWHWTCEV5TYDW2TAIO3M2BG3Z5";

const testKeypair = Keypair.fromSecret(TEST_SECRET);

export async function isConnected(): Promise<boolean> {
  return true;
}

export async function isAllowed(): Promise<boolean> {
  return true;
}

export async function requestAccess(): Promise<string> {
  return testKeypair.publicKey();
}

export async function getPublicKey(): Promise<string> {
  return testKeypair.publicKey();
}

/**
 * Signs the SEP-10 challenge transaction with the fixed test keypair and
 * returns the signed envelope XDR — exactly the shape
 * `useFreighter.ts::connect()` expects back from `signAuthEntry`, and
 * exactly what `backend/src/services/auth.ts::verifyChallengeAndIssueToken`
 * expects to receive and verify.
 */
export async function signAuthEntry(challengeXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET);
  tx.sign(testKeypair);
  return tx.toEnvelope().toXDR("base64");
}

/**
 * Mocked action-signing used before pause/resume calls
 * (`useFreighter.ts::signAction`). The backend's pause/resume routes only
 * require a valid Bearer JWT and do not re-verify this signature, so a
 * fixed placeholder is sufficient here.
 */
export async function signBlob(): Promise<string> {
  return "e2e-mock-signature";
}

/**
 * Not exercised by the create / list / cancel / pause / resume flows this
 * test suite covers (used only by the claim flow in `services/soroban.ts`).
 * Included so the module fully satisfies the real package's surface.
 */
export async function signTransaction(
  xdr: string,
): Promise<{ signedTxXdr: string }> {
  return { signedTxXdr: xdr };
}
