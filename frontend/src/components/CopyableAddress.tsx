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
    truncationMode === "middle"
      ? `${address.slice(0, 8)}…${address.slice(-4)}`
      : `${address.slice(0, 8)}...`;

  return (
    <div
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
        className="btn-ghost"
        style={{
          padding: "0.15rem 0.35rem",
          fontSize: "0.75rem",
          minHeight: "unset",
          lineHeight: "1",
        }}
        title="Copy address"
      >
        {copied ? "✓" : "📋"}
      </button>
    </div>
  );
}
