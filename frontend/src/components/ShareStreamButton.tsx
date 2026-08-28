import { useState } from "react";

interface ShareStreamButtonProps {
  /** Stream ID to share. */
  streamId: string;
}

type CopiedField = "url" | "embed" | null;

/**
 * Share button that generates a public stream URL and an embed snippet.
 *
 * The public URL (/stream/:id) renders the stream's progress without a
 * wallet. The embed snippet is a 300x200 iframe pointing at /embed/:id,
 * which is served without frame-blocking headers so it can be embedded on
 * any site (cross-origin).
 */
export function ShareStreamButton({ streamId }: ShareStreamButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<CopiedField>(null);

  const origin = window.location.origin;
  const publicUrl = `${origin}/stream/${encodeURIComponent(streamId)}`;
  const embedUrl = `${origin}/embed/${encodeURIComponent(streamId)}`;
  const embedSnippet = `<iframe src="${embedUrl}" width="300" height="200" style="border:0" title="StellarStream stream ${streamId}" loading="lazy" />`;

  const handleCopy = async (field: Exclude<CopiedField, null>, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error("Failed to copy text", err);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn-ghost share-btn"
        onClick={() => setOpen(true)}
      >
        🔗 Share
      </button>

      {open && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="modal-panel share-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Share stream"
          >
            <div className="modal-header">
              <h2 className="modal-title">Share Stream</h2>
              <button
                type="button"
                className="modal-close"
                aria-label="Close share dialog"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>

            <p className="modal-stream-hint">
              Anyone with the link can view this stream&apos;s progress — no
              wallet required. Wallet addresses are truncated.
            </p>

            <div className="share-field">
              <label htmlFor="share-public-url">Public link</label>
              <div className="share-field__row">
                <input
                  id="share-public-url"
                  readOnly
                  value={publicUrl}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => handleCopy("url", publicUrl)}
                >
                  {copied === "url" ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="share-field">
              <label htmlFor="share-embed-code">Embed code</label>
              <div className="share-field__row share-field__row--textarea">
                <textarea
                  id="share-embed-code"
                  readOnly
                  rows={3}
                  value={embedSnippet}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => handleCopy("embed", embedSnippet)}
                >
                  {copied === "embed" ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
