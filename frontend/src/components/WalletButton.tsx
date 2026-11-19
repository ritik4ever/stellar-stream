import { useEffect, useRef, useState } from "react";
import { FreighterState } from "../hooks/useFreighter";

interface WalletButtonProps {
  wallet: FreighterState;
}

/** Truncates a Stellar public key to "GABC…WXYZ" format for display. */
function truncateAddress(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function WalletButton({ wallet }: WalletButtonProps) {
  const { installed, address, status, error, connect, disconnect } = wallet;
  const prevAddressRef = useRef<string | null>(address);
  const [announcement, setAnnouncement] = useState<string>("");

  useEffect(() => {
    if (status === "connected" && address) {
      if (prevAddressRef.current && prevAddressRef.current !== address) {
        setAnnouncement(`Wallet account switched to ${truncateAddress(address)}`);
      } else if (!prevAddressRef.current) {
        setAnnouncement(`Wallet connected: ${truncateAddress(address)}`);
      }
      prevAddressRef.current = address;
    } else if (status === "idle" && prevAddressRef.current) {
      setAnnouncement("Wallet disconnected");
      prevAddressRef.current = null;
    } else if (status === "connecting") {
      setAnnouncement("Connecting to wallet…");
    }
  }, [status, address]);

  if (status === "connected" && address) {
    return (
      <div className="wallet-status">
        <span
          className="wallet-address"
          title={address}
          aria-label={`Connected wallet address: ${address}`}
          tabIndex={0}
        >
          <span className="wallet-dot wallet-dot--connected" aria-hidden="true" />
          {truncateAddress(address)}
        </span>
        <button
          className="btn-ghost wallet-disconnect"
          type="button"
          onClick={disconnect}
          aria-label={`Disconnect wallet ${truncateAddress(address)}`}
        >
          Disconnect
        </button>
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="wallet-status-announcement"
        >
          {announcement}
        </div>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="wallet-status">
        <button className="btn-primary wallet-btn" type="button" disabled aria-busy="true">
          Connecting…
        </button>
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="wallet-status-announcement"
        >
          {announcement}
        </div>
      </div>
    );
  }

  const isNetworkMismatch = Boolean(
    error && (
      error.toLowerCase().includes("passphrase") ||
      error.toLowerCase().includes("network mismatch") ||
      error.toLowerCase().includes("wrong network")
    )
  );

  return (
    <div
      className="wallet-status"
      data-boundary-case={
        !installed
          ? "extension-unavailable"
          : isNetworkMismatch
          ? "network-mismatch"
          : undefined
      }
    >
      {!installed && (
        <span
          className="wallet-boundary-tag wallet-boundary-tag--unavailable"
          data-testid="boundary-extension-unavailable"
        >
          Extension unavailable
        </span>
      )}
      {isNetworkMismatch && (
        <span
          className="wallet-boundary-tag wallet-boundary-tag--mismatch"
          data-testid="boundary-network-mismatch"
        >
          Network passphrase mismatch
        </span>
      )}
      {error && (
        <span
          className={`wallet-error ${isNetworkMismatch ? "wallet-error--mismatch" : ""}`}
          role="alert"
        >
          {error}
        </span>
      )}
      {isNetworkMismatch ? (
        <button
          className="btn-primary wallet-btn wallet-btn--mismatch"
          type="button"
          disabled
          aria-disabled="true"
          title="Network passphrase mismatch — switch your wallet to Testnet"
        >
          Wrong Network (Testnet Required)
        </button>
      ) : (
        <button
          className="btn-primary wallet-btn"
          type="button"
          onClick={connect}
          disabled={status === "connecting"}
          title={
            !installed
              ? "Freighter extension not detected — install it from freighter.app"
              : "Connect your Freighter wallet"
          }
        >
          {!installed ? "Install Freighter" : "Connect Wallet"}
        </button>
      )}
      {(!installed || Boolean(error)) && (
        <button
          className="btn-ghost wallet-retry-btn"
          type="button"
          onClick={connect}
          disabled={status === "connecting"}
          data-testid="wallet-retry-btn"
          aria-label="Retry wallet connection"
        >
          Retry Connection
        </button>
      )}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="wallet-status-announcement"
      >
        {announcement}
      </div>
    </div>
  );
}
