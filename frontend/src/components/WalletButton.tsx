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

  if (status === "connected" && address) {
    return (
      <div className="wallet-status">
        <span className="wallet-address" title={address}>
          <span className="wallet-dot wallet-dot--connected" aria-hidden />
          {truncateAddress(address)}
        </span>
        <button
          className="btn-ghost wallet-disconnect"
          type="button"
          onClick={disconnect}
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <button className="btn-primary wallet-btn" type="button" disabled aria-busy>
        Connecting…
      </button>
    );
  }

  return (
    <div className="wallet-status">
      {error && (
        <span className="wallet-error" role="alert">
          {error}
        </span>
      )}
      <button
        className="btn-primary wallet-btn"
        type="button"
        onClick={connect}
        title={
          !installed
            ? "Freighter extension not detected — install it from freighter.app"
            : "Connect your Freighter wallet"
        }
      >
        {!installed ? "Install Freighter" : "Connect Wallet"}
      </button>
    </div>
  );
}
