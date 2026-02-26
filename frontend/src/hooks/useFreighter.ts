import { useCallback, useEffect, useState } from "react";
import {
  isConnected,
  isAllowed,
  requestAccess,
  getPublicKey,
  signAuthEntry,
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
          const pk = await getPublicKey();
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
      const pk = await requestAccess();
      if (!pk) throw new Error("Freighter did not return an account address.");

      setInstalled(true);

      // 1. Fetch challenge
      const challengeXdr = await getAuthChallenge(pk);

      // 2. Sign auth entry challenge using Freighter
      // Note: signAuthEntry is the modern way to sign SEP-10 txs in Freighter
      const signedChallenge = await signAuthEntry(challengeXdr);

      // 3. Trade signed challenge for real JWT
      const token = await verifyAuthToken(signedChallenge);

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

  return { installed, allowed, address, status, error, connect, disconnect };
}
