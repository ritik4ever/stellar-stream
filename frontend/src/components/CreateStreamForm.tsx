import { FormEvent, useEffect, useState } from "react";
import { CreateStreamPayload } from "../types/stream";
import {
  FieldErrors,
  FormValues,
  isStellarAccount,
  validateForm,
  isFormValid,
} from "../hooks/useFormValidation";

interface CreateStreamFormProps {
  onCreate: (payload: CreateStreamPayload) => Promise<void>;
  apiError?: string | null;
  /** Public key from a connected Freighter wallet, or null if not connected. */
  walletAddress?: string | null;
}

// Derive a user-friendly hint from a raw API error message.
function humaniseApiError(raw: string): { title: string; hint: string } {
  const lower = raw.toLowerCase();

  if (lower.includes("sender") || lower.includes("recipient")) {
    return {
      title: "Invalid account ID",
      hint: 'Double-check that both account IDs start with "G" and are exactly 56 characters. You can copy them from Stellar Laboratory.',
    };
  }
  if (lower.includes("asset") || lower.includes("assetcode")) {
    return {
      title: "Invalid asset code",
      hint: 'Asset codes must be 1–12 alphanumeric characters. Common examples: USDC, XLM, AQUA.',
    };
  }
  if (lower.includes("amount")) {
    return {
      title: "Invalid amount",
      hint: "The total amount must be a positive number. Check that you haven't entered zero or a negative value.",
    };
  }
  if (lower.includes("duration") || lower.includes("seconds")) {
    return {
      title: "Invalid duration",
      hint: "Stream duration must be at least 1 hour (3 600 seconds). Increase the duration and try again.",
    };
  }
  if (lower.includes("not found")) {
    return {
      title: "Stream not found",
      hint: "This stream may have already been cancelled or never existed. Refresh the page to see the latest state.",
    };
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return {
      title: "Network error",
      hint: "Could not reach the StellarStream API. Ensure the backend is running and your network connection is stable.",
    };
  }

  return {
    title: "Something went wrong",
    hint: raw,
  };
}

// StellarAccountStatus: live character-count + format hint shown under account fields.
function AccountHint({ value }: { value: string }) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const len = trimmed.length;
  const valid = isStellarAccount(trimmed);

  if (valid) {
    return (
      <span className="field-hint field-hint--ok" aria-live="polite">
        ✓ Valid Stellar account ({len}/56)
      </span>
    );
  }

  if (!trimmed.startsWith("G")) {
    return (
      <span className="field-hint field-hint--warn" aria-live="polite">
        Account IDs must start with the letter G ({len}/56 chars)
      </span>
    );
  }

  return (
    <span className="field-hint field-hint--warn" aria-live="polite">
      {len < 56 ? `${56 - len} more character${56 - len !== 1 ? "s" : ""} needed` : "Too long — must be exactly 56 characters"}{" "}
      ({len}/56)
    </span>
  );
}

const INITIAL_VALUES: FormValues = {
  sender: "",
  recipient: "",
  assetCode: "USDC",
  totalAmount: "150",
  durationHours: "24",
  startInMinutes: "0",
};

export function CreateStreamForm({ onCreate, apiError, walletAddress }: CreateStreamFormProps) {
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Auto-fill sender from connected wallet; clear it when wallet disconnects.
  useEffect(() => {
    setValues((prev) => ({ ...prev, sender: walletAddress ?? "" }));
    setTouched((prev) => ({ ...prev, sender: !!walletAddress }));
  }, [walletAddress]);

  // Run validation on current values
  const errors: FieldErrors = validateForm(values);
  const formValid = isFormValid(errors);

  function set(field: keyof FormValues) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setValues((prev) => ({ ...prev, [field]: e.target.value }));
    };
  }

  function blur(field: keyof FormValues) {
    return () => setTouched((prev) => ({ ...prev, [field]: true }));
  }

  // Show an error for a field only after the user has touched it (or tried to submit)
  function fieldError(field: keyof FormValues): string | undefined {
    return (touched[field] || submitAttempted) ? errors[field] : undefined;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitAttempted(true);

    if (!walletAddress) return; // wallet must be connected
    if (!formValid) return;

    setIsSubmitting(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const offsetMinutes = Number(values.startInMinutes);
      const startAt = offsetMinutes > 0 ? now + Math.floor(offsetMinutes * 60) : undefined;

      await onCreate({
        sender: values.sender.trim(),
        recipient: values.recipient.trim(),
        assetCode: values.assetCode.trim().toUpperCase(),
        totalAmount: Number(values.totalAmount),
        durationSeconds: Math.floor(Number(values.durationHours) * 3600),
        startAt,
      });

      // Reset on success — preserve auto-filled sender if wallet is still connected.
      setValues({ ...INITIAL_VALUES, sender: walletAddress ?? "" });
      setTouched(walletAddress ? { sender: true } : {});
      setSubmitAttempted(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  const parsedApiError = apiError ? humaniseApiError(apiError) : null;

  return (
    <form className="card form-grid" onSubmit={handleSubmit} noValidate>
      <h2>Create Stream</h2>

      {/* API error banner — only shown for API-level errors */}
      {parsedApiError && (
        <div className="api-error-box" role="alert" aria-live="assertive">
          <div className="api-error-box__title">
            <span className="api-error-box__icon" aria-hidden>⚠</span>
            {parsedApiError.title}
          </div>
          <div className="api-error-box__hint">{parsedApiError.hint}</div>
        </div>
      )}

      {/* Sender */}
      <div className={`field-group${fieldError("sender") ? " field-group--error" : ""}`}>
        <label htmlFor="stream-sender">
          Sender Account
          <span className="field-required" aria-hidden> *</span>
          {walletAddress && (
            <span className="field-hint field-hint--ok" style={{ fontWeight: "normal" }}>
              {" "}— auto-filled from wallet
            </span>
          )}
        </label>
        <input
          id="stream-sender"
          type="text"
          value={values.sender}
          onChange={walletAddress ? undefined : set("sender")}
          onBlur={blur("sender")}
          placeholder="Connect wallet or paste a 56-character Stellar public key"
          aria-describedby={fieldError("sender") ? "sender-error" : "sender-hint"}
          aria-invalid={!!fieldError("sender")}
          autoComplete="off"
          spellCheck={false}
          readOnly={!!walletAddress}
          className={walletAddress ? "input-readonly" : undefined}
        />
        <AccountHint value={values.sender} />
        {fieldError("sender") && (
          <span id="sender-error" className="field-error" role="alert">
            {fieldError("sender")}
          </span>
        )}
      </div>

      {/* Recipient */}
      <div className={`field-group${fieldError("recipient") ? " field-group--error" : ""}`}>
        <label htmlFor="stream-recipient">
          Recipient Account
          <span className="field-required" aria-hidden> *</span>
        </label>
        <input
          id="stream-recipient"
          type="text"
          value={values.recipient}
          onChange={set("recipient")}
          onBlur={blur("recipient")}
          placeholder="G…  (56-character Stellar public key)"
          aria-describedby={fieldError("recipient") ? "recipient-error" : "recipient-hint"}
          aria-invalid={!!fieldError("recipient")}
          autoComplete="off"
          spellCheck={false}
        />
        <AccountHint value={values.recipient} />
        {fieldError("recipient") && (
          <span id="recipient-error" className="field-error" role="alert">
            {fieldError("recipient")}
          </span>
        )}
      </div>

      <div className="row">
        {/* Asset Code */}
        <div className={`field-group${fieldError("assetCode") ? " field-group--error" : ""}`}>
          <label htmlFor="stream-asset">
            Asset Code
            <span className="field-required" aria-hidden> *</span>
          </label>
          <input
            id="stream-asset"
            type="text"
            value={values.assetCode}
            onChange={set("assetCode")}
            onBlur={blur("assetCode")}
            placeholder="USDC"
            maxLength={12}
            aria-describedby={fieldError("assetCode") ? "asset-error" : undefined}
            aria-invalid={!!fieldError("assetCode")}
          />
          {fieldError("assetCode") && (
            <span id="asset-error" className="field-error" role="alert">
              {fieldError("assetCode")}
            </span>
          )}
        </div>

        {/* Total Amount */}
        <div className={`field-group${fieldError("totalAmount") ? " field-group--error" : ""}`}>
          <label htmlFor="stream-amount">
            Total Amount
            <span className="field-required" aria-hidden> *</span>
          </label>
          <input
            id="stream-amount"
            type="number"
            min="0.000001"
            step="0.000001"
            value={values.totalAmount}
            onChange={set("totalAmount")}
            onBlur={blur("totalAmount")}
            onKeyDown={(e) => {
              // Block 'e', 'E', '+' which browsers allow in type=number
              if (["e", "E", "+"].includes(e.key)) e.preventDefault();
            }}
            aria-describedby={fieldError("totalAmount") ? "amount-error" : undefined}
            aria-invalid={!!fieldError("totalAmount")}
          />
          {fieldError("totalAmount") && (
            <span id="amount-error" className="field-error" role="alert">
              {fieldError("totalAmount")}
            </span>
          )}
        </div>
      </div>

      <div className="row">
        {/* Duration */}
        <div className={`field-group${fieldError("durationHours") ? " field-group--error" : ""}`}>
          <label htmlFor="stream-duration">
            Duration (hours)
            <span className="field-required" aria-hidden> *</span>
          </label>
          <input
            id="stream-duration"
            type="number"
            min="1"
            step="1"
            value={values.durationHours}
            onChange={set("durationHours")}
            onBlur={blur("durationHours")}
            onKeyDown={(e) => {
              if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
            }}
            aria-describedby={fieldError("durationHours") ? "duration-error" : undefined}
            aria-invalid={!!fieldError("durationHours")}
          />
          {fieldError("durationHours") && (
            <span id="duration-error" className="field-error" role="alert">
              {fieldError("durationHours")}
            </span>
          )}
        </div>

        {/* Start In */}
        <div className={`field-group${fieldError("startInMinutes") ? " field-group--error" : ""}`}>
          <label htmlFor="stream-start">
            Start In (minutes)
            <span className="field-required" aria-hidden> *</span>
          </label>
          <input
            id="stream-start"
            type="number"
            min="0"
            step="1"
            value={values.startInMinutes}
            onChange={set("startInMinutes")}
            onBlur={blur("startInMinutes")}
            onKeyDown={(e) => {
              if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
            }}
            aria-describedby={
              fieldError("startInMinutes") ? "start-error" : "start-hint"
            }
            aria-invalid={!!fieldError("startInMinutes")}
          />
          <span id="start-hint" className="field-hint">
            Enter 0 to start immediately
          </span>
          {fieldError("startInMinutes") && (
            <span id="start-error" className="field-error" role="alert">
              {fieldError("startInMinutes")}
            </span>
          )}
        </div>
      </div>

      {/* Wallet-not-connected guard */}
      {!walletAddress && (
        <p className="wallet-required-notice" role="alert">
          Connect your Freighter wallet to create a stream.
        </p>
      )}

      {/* Submit */}
      <button
        className="btn-primary"
        type="submit"
        disabled={isSubmitting || !walletAddress || (submitAttempted && !formValid)}
        aria-busy={isSubmitting}
        title={!walletAddress ? "Connect your wallet first" : undefined}
      >
        {isSubmitting ? "Creating…" : "Create Stream"}
      </button>

      {/* Summary validation notice shown after first submit attempt */}
      {submitAttempted && !formValid && (
        <p className="form-summary-error" role="alert">
          Please fix the errors above before submitting.
        </p>
      )}
    </form>
  );
}
