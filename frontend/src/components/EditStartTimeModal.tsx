/**
 * EditStartTimeModal.tsx
 *
 * Fully keyboard-accessible modal for editing a stream's start time.
 *
 * Accessibility features (ref: WCAG 2.1 §3.2, ARIA Authoring Practices modal pattern):
 *  - role="dialog" + aria-modal="true" on the panel (not the backdrop)
 *  - aria-labelledby links the panel to its visible heading
 *  - aria-describedby links the panel to its hint text
 *  - Focus moves into the modal (datetime input) on open
 *  - Focus is fully trapped inside while the modal is open (Tab/Shift+Tab)
 *  - Escape closes the modal safely without submitting
 *  - Focus returns to the triggering button on close
 *  - Field errors are announced via aria-live="assertive" + aria-invalid
 *  - API errors are announced via role="alert"
 *  - Backdrop click closes the modal (mouse users)
 */

import { useEffect, useRef, useState } from "react";
import { Stream } from "../types/stream";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface EditStartTimeModalProps {
  stream: Stream;
  /** Ref to the button that opened the modal — focus returns here on close. */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onConfirm: (streamId: string, newStartAt: number) => Promise<void>;
  onClose: () => void;
}

/** Convert a UNIX timestamp (seconds) to a datetime-local string value */
function toDatetimeLocal(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

/** Convert a datetime-local string to a UNIX timestamp in seconds */
function fromDatetimeLocal(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

export function EditStartTimeModal({
  stream,
  triggerRef,
  onConfirm,
  onClose,
}: EditStartTimeModalProps) {
  const [value, setValue] = useState<string>(() =>
    toDatetimeLocal(stream.startAt),
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** Ref to the datetime input — receives focus on open */
  const inputRef = useRef<HTMLInputElement>(null);

  /** Focus trap on the modal panel */
  const panelRef = useFocusTrap<HTMLDivElement>(true);

  // ── Focus management ─────────────────────────────────────────────────

  // Move focus into the modal input when it opens
  useEffect(() => {
    // Small rAF to ensure the DOM is painted before focusing
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Return focus to the trigger button when the modal closes
  useEffect(() => {
    return () => {
      triggerRef?.current?.focus();
    };
  }, [triggerRef]);

  // ── Keyboard handling ─────────────────────────────────────────────────

  // Escape closes the modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    // Capture phase so Escape is caught before any nested handlers
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // ── Form logic ────────────────────────────────────────────────────────

  function validate(): number | null {
    setFieldError(null);
    if (!value) {
      setFieldError("Please select a date and time.");
      return null;
    }
    const ts = fromDatetimeLocal(value);
    if (isNaN(ts)) {
      setFieldError("Invalid date/time.");
      return null;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (ts <= nowSec) {
      setFieldError("Start time must be in the future.");
      return null;
    }
    return ts;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ts = validate();
    if (ts === null) {
      // Move focus back to the invalid input so screen readers re-announce it
      inputRef.current?.focus();
      return;
    }

    setApiError(null);
    setLoading(true);
    try {
      await onConfirm(stream.id, ts);
      onClose();
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "Failed to update start time.",
      );
    } finally {
      setLoading(false);
    }
  }

  // min is 1 minute from now so the browser native picker reflects the constraint
  const minDatetime = toDatetimeLocal(Math.floor(Date.now() / 1000) + 60);

  // Stable IDs for aria wiring
  const titleId = "edit-start-time-title";
  const hintId  = "edit-start-time-hint";
  const inputId = "edit-start-time-input";
  const errorId = "edit-start-time-error";

  return (
    /* Backdrop — click-to-close, but NOT the dialog root */
    <div
      className="modal-backdrop"
      aria-hidden="false"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/*
       * Dialog panel — role="dialog" lives here (not on the backdrop)
       * so AT users read the panel, not the invisible overlay.
       * aria-describedby links to the stream-context hint.
       */}
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
      >
        {/* Header */}
        <div className="modal-header">
          <h3 id={titleId} className="modal-title">
            Edit Start Time
          </h3>
          <button
            type="button"
            className="modal-close"
            aria-label="Close edit start time dialog"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Stream context — linked via aria-describedby */}
        <p id={hintId} className="modal-stream-hint">
          Stream&nbsp;<strong>#{stream.id}</strong>&nbsp;·&nbsp;
          {stream.totalAmount}&nbsp;{stream.assetCode}
        </p>

        <form onSubmit={handleSubmit} noValidate aria-label="Edit start time">
          <div
            className={`field-group${fieldError ? " field-group--error" : ""}`}
          >
            <label htmlFor={inputId}>
              New start time <span className="field-required" aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="datetime-local"
              value={value}
              min={minDatetime}
              aria-required="true"
              aria-invalid={fieldError !== null}
              aria-describedby={fieldError ? errorId : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setFieldError(null);
              }}
            />
            {/*
             * aria-live="assertive" so screen readers announce the error
             * immediately without waiting for the next polite update.
             */}
            <p
              id={errorId}
              className="field-error"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              style={{ minHeight: "1.2em" }}
            >
              {fieldError ?? ""}
            </p>
          </div>

          {/* API-level error — role="alert" triggers immediate announcement */}
          {apiError && (
            <div className="api-error-box" role="alert" aria-live="assertive">
              <div className="api-error-box__title">
                <span className="api-error-box__icon" aria-hidden="true">⚠️</span>
                Update failed
              </div>
              <p className="api-error-box__hint">{apiError}</p>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              id="edit-start-time-submit"
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
