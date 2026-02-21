import { useEffect, useRef, useState } from "react";
import { Stream } from "../types/stream";

interface EditStartTimeModalProps {
    stream: Stream;
    onConfirm: (streamId: string, newStartAt: number) => Promise<void>;
    onClose: () => void;
}

/** Convert a UNIX timestamp (seconds) to a datetime-local string value */
function toDatetimeLocal(unixSeconds: number): string {
    const d = new Date(unixSeconds * 1000);
    // Pad helper
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
    onConfirm,
    onClose,
}: EditStartTimeModalProps) {
    const [value, setValue] = useState<string>(() =>
        toDatetimeLocal(stream.startAt),
    );
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [apiError, setApiError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus the input when modal opens
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Close on Escape
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

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
        if (ts === null) return;

        setApiError(null);
        setLoading(true);
        try {
            await onConfirm(stream.id, ts);
            onClose();
        } catch (err) {
            setApiError(err instanceof Error ? err.message : "Failed to update start time.");
        } finally {
            setLoading(false);
        }
    }

    // min is 1 minute from now so the browser native picker reflects the constraint
    const minDatetime = toDatetimeLocal(Math.floor(Date.now() / 1000) + 60);

    return (
        /* backdrop */
        <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-start-time-title"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="modal-panel">
                {/* Header */}
                <div className="modal-header">
                    <h3 id="edit-start-time-title" className="modal-title">
                        Edit Start Time
                    </h3>
                    <button
                        type="button"
                        className="modal-close"
                        aria-label="Close"
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </div>

                {/* Stream context */}
                <p className="modal-stream-hint">
                    Stream&nbsp;<strong>#{stream.id}</strong>&nbsp;·&nbsp;
                    {stream.totalAmount}&nbsp;{stream.assetCode}
                </p>

                <form onSubmit={handleSubmit} noValidate>
                    <div className={`field-group${fieldError ? " field-group--error" : ""}`}>
                        <label htmlFor="edit-start-time-input">
                            New start time <span className="field-required">*</span>
                        </label>
                        <input
                            id="edit-start-time-input"
                            ref={inputRef}
                            type="datetime-local"
                            value={value}
                            min={minDatetime}
                            onChange={(e) => {
                                setValue(e.target.value);
                                setFieldError(null);
                            }}
                        />
                        {fieldError && <p className="field-error">{fieldError}</p>}
                    </div>

                    {apiError && (
                        <div className="api-error-box" role="alert">
                            <div className="api-error-box__title">
                                <span className="api-error-box__icon">⚠️</span>
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
                        >
                            {loading ? "Saving…" : "Save"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
