import { useState } from "react";

interface CopyableAddressProps {
  address: string;
  truncationMode?: "middle" | "end";
}

export function CopyableAddress({
  address,
  truncationMode = "middle",
}: CopyableAddressProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text", err);
    }
  };

  const truncatedAddress =
    address.length <= 12
      ? address
      : truncationMode === "middle"
      ? `${address.slice(0, 8)}…${address.slice(-4)}`
      : `${address.slice(0, 8)}...`;

  return (
    <div
      className="copyable-address"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
      }}
    >
      <span className="truncate-address" title={address}>
        {truncatedAddress}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        className="btn-ghost copyable-address__copy"
        style={{
          padding: "0.15rem 0.35rem",
          fontSize: "0.75rem",
          minHeight: "44px",
          lineHeight: "1",
        }}
        title="Copy address"
      >
        {copied ? "✓" : "📋"}
      </button>
    </div>
  );
}
