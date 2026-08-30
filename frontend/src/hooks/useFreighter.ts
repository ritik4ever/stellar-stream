import { useCallback, useEffect, useState } from "react";
import {
  isConnected,
  isAllowed,
  getAddress,
  requestAccess,
  signAuthEntry,
  signMessage,
} from "@stellar/freighter-api";
import { getAuthChallenge, verifyAuthToken } from "../services/auth";
import { setAuthToken } from "../services/api";

export type WalletStatus = "idle" | "connecting" | "connected" | "error";

export interface FreighterState {
  /** Whether the Freighter extension is installed in the browser. */
  installed: boolean;
  /** Whether the user has authorized this app in Freighter. */
  allowed: boolean;
  /** The connected wallet's Stellar public key, or null if not connected. */
  address: string | null;
  status: WalletStatus;
  /** Human-readable error message, or null when there is no error. */
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  /**
   * Sign an arbitrary action payload via Freighter's signBlob.
   * The payload is JSON-serialised, UTF-8 encoded, then base64'd before signing.
   * Returns the base64 signature string from Freighter.
   */
  signAction: (payload: Record<string, unknown>) => Promise<string>;
}

const STORAGE_KEY = "stellar_stream_auth_token";
const NETWORK = "TESTNET";

export function useFreighter(): FreighterState {
  const [installed, setInstalled] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // On mount: detect extension and restore an already-allowed session.
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        const connected = await isConnected();
        if (cancelled) return;

        if (!connected) {
          setInstalled(false);
          return;
        }
        setInstalled(true);

        const permitted = await isAllowed();
        if (cancelled) return;

        if (permitted) {
          const { address: pk } = await getAddress();
          const storedToken = localStorage.getItem(STORAGE_KEY);
          if (cancelled) return;
          if (pk && storedToken) {
            setAuthToken(storedToken);
            setAllowed(true);
            setAddress(pk);
            setStatus("connected");
          }
        }
      } catch {
        // Extension not available — silently ignore on initial probe.
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      const { address: pk, error: accessError } = await requestAccess();
      if (accessError) throw new Error(accessError.message);
      if (!pk) throw new Error("Freighter did not return an account address.");

      setInstalled(true);

      // 1. Fetch challenge
      const challengeXdr = await getAuthChallenge(pk);

      // 2. Sign auth entry challenge using Freighter
      // Note: signAuthEntry is the modern way to sign SEP-10 txs in Freighter
      const { signedAuthEntry, error: signError } = await signAuthEntry(challengeXdr);
      if (signError || !signedAuthEntry) throw new Error(signError?.message ?? "Failed to sign challenge");

      // 3. Trade signed challenge for real JWT
      const token = await verifyAuthToken(signedAuthEntry);

      localStorage.setItem(STORAGE_KEY, token);
      setAuthToken(token);

      setAllowed(true);
      setAddress(pk);
      setStatus("connected");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to connect to Freighter.";
      // User rejected → friendly message
      const friendly = msg.toLowerCase().includes("user declined")
        ? "Connection cancelled — please approve the request in Freighter."
        : msg;

      localStorage.removeItem(STORAGE_KEY);
      setAuthToken(null);
      setError(friendly);
      setStatus("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    setAddress(null);
    setAllowed(false);
    setStatus("idle");
    setError(null);
  }, []);

  const signAction = useCallback(
    async (payload: Record<string, unknown>): Promise<string> => {
      const json = JSON.stringify(payload);
      const base64 = btoa(unescape(encodeURIComponent(json)));
      const result = await signMessage(base64, {
        address: address ?? undefined,
      });
      if (!result.signedMessage) throw new Error("signMessage returned no result");
      return typeof result.signedMessage === 'string' ? result.signedMessage : result.signedMessage.toString();
    },
    [address],
  );

  return { installed, allowed, address, status, error, connect, disconnect, signAction };
}
