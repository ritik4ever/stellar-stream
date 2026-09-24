import { useState, useEffect, FormEvent } from "react";
import {
  estimateCreateStreamFee,
  getConfig,
  type StreamFeeEstimate,
} from "../services/api";
// Form Draft Autosave [Verified]: Survives refresh, clears on submit/discard, aligns with fields.
import { useDraftAutosave } from "../hooks/useDraftAutosave";
import { CreateStreamPayload, CreateSplitStreamPayload } from "../types/stream";
import {
  FieldErrors,
  FormValues,
  isStellarAccount,
  validateForm,
  isFormValid,
} from "../hooks/useFormValidation";

type StreamMode = "single" | "split";

interface SplitRecipient {
  address: string;
  percentage: string;
}

interface CreateStreamFormProps {
  onCreate: (payload: CreateStreamPayload) => Promise<void>;
  onCreateSplit?: (payload: CreateSplitStreamPayload) => Promise<void>;
  apiError?: string | null;
  walletAddress?: string | null;
}

/**
 * Converts raw API error messages into user-friendly titles and hints.
 * @param raw - The raw error message from the API.
 * @returns An object containing a friendly title and hint.
 */
interface FeePreview {
  payload: CreateStreamPayload;
  estimate: StreamFeeEstimate;
}

function humaniseApiError(raw: string): { title: string; hint: string } {
  const lower = raw.toLowerCase();

  if (lower.includes("sender") || lower.includes("recipient")) {
    return {
      title: "Invalid account ID",
      hint: 'Double-check that both account IDs start with "G" and are exactly 56 characters. You can copy them from Stellar Laboratory.',
    };
  }
  if (
    lower.includes("asset") ||
    lower.includes("assetcode") ||
    lower.includes("supported")
  ) {
    return {
      title: "Invalid asset code",
      hint: raw,
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
      hint: "Stream duration must be at least 1 minute (60 seconds). Increase the duration and try again.",
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

  return { title: "Something went wrong", hint: raw };
}

/**
 * Displays a validation hint for a Stellar account ID.
 * @param props - The component props containing the account address.
 * @returns The rendered AccountHint component.
 */
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
      {len < 56
        ? `${56 - len} more character${56 - len !== 1 ? "s" : ""} needed`
        : "Too long — must be exactly 56 characters"}{" "}
      ({len}/56)
    </span>
  );
}

const INITIAL_VALUES: FormValues = {
  streamType: "recurring",
  sender: "",
  recipient: "",
  assetCode: "USDC",
  totalAmount: "150",
  durationMinutes: "1440",
  startInMinutes: "0",
  cliffDays: "0",
};

// Initial fallback if fetch hasn't completed or failed
const DEFAULT_ALLOWED_ASSETS = ["USDC", "XLM"];

/**
 * Form component for creating a new payment stream.
 * Includes validation, draft autosave, and estimated end date calculation.
 * 
 * @param props - The component props.
 * @returns The rendered CreateStreamForm component.
 */
function buildCreateStreamPayload(values: FormValues): CreateStreamPayload {
  const now = Math.floor(Date.now() / 1000);
  const offsetMinutes = Number(values.startInMinutes);
  const startAt =
    offsetMinutes > 0 ? now + Math.floor(offsetMinutes * 60) : undefined;

  const cliffDays = Number(values.cliffDays || "0");
  const cliffSeconds = cliffDays > 0 ? Math.floor(cliffDays * 86400) : undefined;

  return {
    sender: values.sender.trim(),
    recipient: values.recipient.trim(),
    assetCode: values.assetCode.trim().toUpperCase(),
    totalAmount: Number(values.totalAmount),
    durationSeconds: Math.floor(Number(values.durationMinutes) * 60),
    startAt,
    cliffSeconds,
  };
}

function formatStreamRate(payload: CreateStreamPayload): string {
  const durationHours = payload.durationSeconds / 3600;
  const ratePerHour = durationHours > 0 ? payload.totalAmount / durationHours : 0;
  return `${ratePerHour.toFixed(6)} ${payload.assetCode}/hour`;
}

export function CreateStreamForm({
  onCreate,
  onCreateSplit,
  apiError,
  walletAddress,
}: CreateStreamFormProps) {
  const [values, setValues, hasDraft, clearDraft] = useDraftAutosave<FormValues>(
    "stellar-stream:create-draft",
    INITIAL_VALUES,
    2000 // Autosave every 2 seconds
  );
  const [allowedAssets, setAllowedAssets] = useState<string[]>([]);
  const [configFetchFailed, setConfigFetchFailed] = useState(false);
  const [streamMode, setStreamMode] = useState<StreamMode>("single");
  const [splitRecipients, setSplitRecipients] = useState<SplitRecipient[]>([
    { address: "", percentage: "50" },
    { address: "", percentage: "50" },
  ]);
  const [splitErrors, setSplitErrors] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);

  useEffect(() => {
    async function fetchConfig() {
      try {
        const config = await getConfig();
        setAllowedAssets(config.allowedAssets);
        
        // Handle defaulting logic
        const currentAsset = values.assetCode;
        const isCurrentValid = config.allowedAssets.includes(currentAsset);
        
        if (!isCurrentValid) {
          if (config.allowedAssets.includes("USDC")) {
            setValues(prev => ({ ...prev, assetCode: "USDC" }));
          } else if (config.allowedAssets.length > 0) {
            setValues(prev => ({ ...prev, assetCode: config.allowedAssets[0] }));
          }
        }
      } catch (err) {
        console.error("Failed to fetch config:", err);
        setConfigFetchFailed(true);
      }
    }
    fetchConfig();
  }, []); // Only fetch once on mount
  const [touched, setTouched] = useState<
    Partial<Record<keyof FormValues, boolean>>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [feePreview, setFeePreview] = useState<FeePreview | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const errors: FieldErrors = validateForm(values);
  const formValid = isFormValid(errors);

  function set(field: keyof FormValues) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setValues((prev) => ({ ...prev, [field]: e.target.value }));
    };
  }

  function blur(field: keyof FormValues) {
    return () => setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function addSplitRecipient() {
    if (splitRecipients.length >= 10) return;
    setSplitRecipients((prev) => [...prev, { address: "", percentage: "0" }]);
  }

  function removeSplitRecipient(index: number) {
    if (splitRecipients.length <= 2) return;
    setSplitRecipients((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSplitRecipient(index: number, field: "address" | "percentage", value: string) {
    setSplitRecipients((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  function validateSplitRecipients(): string | null {
    const totalPct = splitRecipients.reduce((sum, r) => sum + Number(r.percentage || 0), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      return `Allocations must sum to exactly 100% (currently ${totalPct.toFixed(1)}%)`;
    }
    for (let i = 0; i < splitRecipients.length; i++) {
      const addr = splitRecipients[i].address.trim();
      if (!addr) return `Recipient ${i + 1} address is required.`;
      if (!isStellarAccount(addr)) return `Recipient ${i + 1} has an invalid Stellar address.`;
      const pct = Number(splitRecipients[i].percentage);
      if (isNaN(pct) || pct <= 0) return `Recipient ${i + 1} percentage must be positive.`;
    }
    return null;
  }

  const splitValidationError = streamMode === "split" ? validateSplitRecipients() : null;
  const isSplitValid = streamMode === "split" ? splitValidationError === null : true;

  function canProceedToNextStep() {
    if (currentStep === 1) return true;
    if (currentStep === 2) {
      if (errors.sender || errors.assetCode || errors.totalAmount) return false;
      if (streamMode === "single" && errors.recipient) return false;
      if (streamMode === "split" && !isSplitValid) return false;
      return true;
    }
    if (currentStep === 3) {
      if (errors.durationMinutes || errors.startInMinutes || errors.cliffDays) return false;
      return true;
    }
    return true;
  }

  function handleNext(e?: React.MouseEvent) {
    if (e) e.preventDefault();
    setSubmitAttempted(true);
    if (!canProceedToNextStep()) return;
    setSubmitAttempted(false);
    setCurrentStep(prev => Math.min(prev + 1, 4));
  }

  function handlePrev(e?: React.MouseEvent) {
    if (e) e.preventDefault();
    setCurrentStep(prev => Math.max(prev - 1, 1));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitAttempted(true);
    setSimulationError(null);
    setSplitErrors(null);

    if (!walletAddress) return;

    if (streamMode === "split") {
      const splitErr = validateSplitRecipients();
      if (splitErr) {
        setSplitErrors(splitErr);
        return;
      }
      // For split streams, skip recipient validation from single mode
      const singleErrors = validateForm(values);
      delete singleErrors.recipient;
      if (!isFormValid(singleErrors)) return;

      if (!onCreateSplit) {
        setSimulationError("Split stream creation is not supported yet.");
        return;
      }

      setIsSubmitting(true);
      try {
        const now = Math.floor(Date.now() / 1000);
        const offsetMinutes = Number(values.startInMinutes);
        const startAt = offsetMinutes > 0 ? now + Math.floor(offsetMinutes * 60) : undefined;

        const splitPayload: CreateSplitStreamPayload = {
          sender: values.sender.trim(),
          assetCode: values.assetCode.trim().toUpperCase(),
          totalAmount: Number(values.totalAmount),
          durationSeconds: Math.floor(Number(values.durationMinutes) * 60),
          startAt,
          recipients: splitRecipients.map((r) => ({
            address: r.address.trim(),
            percentage: Number(r.percentage),
          })),
        };

        await onCreateSplit(splitPayload);
        clearDraft();
        setTouched({});
        setSubmitAttempted(false);
        setSplitRecipients([
          { address: "", percentage: "50" },
          { address: "", percentage: "50" },
        ]);
      } catch (err) {
        setSimulationError(
          err instanceof Error ? err.message : "Failed to create split stream.",
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!formValid) return;

    setIsSubmitting(true);
    try {
      const payload = buildCreateStreamPayload(values);
      const estimate = await estimateCreateStreamFee(payload);
      setFeePreview({ payload, estimate });
    } catch (err) {
      setSimulationError(
        err instanceof Error ? err.message : "Failed to estimate network fee.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmCreateStream() {
    if (!feePreview) return;

    setIsSubmitting(true);
    setSimulationError(null);
    try {
      await onCreate(feePreview.payload);
      clearDraft();
      setTouched({});
      setSubmitAttempted(false);
      setFeePreview(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  const parsedApiError = apiError ? humaniseApiError(apiError) : null;

  const startInMinsNum = Number(values.startInMinutes);
  const durationMinsNum = Number(values.durationMinutes);
  const estimatedEndLabel: string | null = (() => {
    if (
      values.startInMinutes === "" ||
      values.durationMinutes === "" ||
      isNaN(startInMinsNum) ||
      isNaN(durationMinsNum) ||
      durationMinsNum < 1 ||
      !Number.isInteger(durationMinsNum)
    ) {
      return null;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const startAt =
      startInMinsNum > 0 ? nowSeconds + Math.floor(startInMinsNum * 60) : nowSeconds;
    const endAt = startAt + Math.floor(durationMinsNum * 60);
    const endDate = new Date(endAt * 1000);
    const datePart = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(endDate);
    const timePart = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(endDate);
    return `Ends: ${datePart} at ${timePart} UTC`;
  })();

  return (
    <>
    <form onSubmit={handleSubmit} noValidate>
      {hasDraft && (
        <div
          className="draft-recovery-banner"
          role="status"
          aria-live="polite"
          aria-label="Draft recovered"
        >
          ✓ Your unsaved draft has been recovered. You can{" "}
          <button
            type="button"
            className="draft-recovery-banner__discard-link"
            onClick={() => {
              if (window.confirm("Discard your unsaved stream draft?")) {
                clearDraft();
                setTouched({});
                setSubmitAttempted(false);
              }
            }}
            disabled={isSubmitting}
          >
            discard it
          </button>{" "}
          if you prefer to start over.
        </div>
      )}

      {parsedApiError && (
        <div className="api-error-box">
          <div className="api-error-box__title">{parsedApiError.title}</div>
          <div className="api-error-box__hint">{parsedApiError.hint}</div>
        </div>
      )}

      {/* Progress Bar */}
      <div className="progress-bar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
        {[1, 2, 3, 4].map(step => (
          <div key={step} style={{ 
            flex: 1, 
            height: '4px', 
            margin: '0 4px', 
            backgroundColor: currentStep >= step ? 'var(--color-primary, #007bff)' : '#e0e0e0',
            borderRadius: '2px'
          }} />
        ))}
      </div>

      <div style={{ display: currentStep === 1 ? 'block' : 'none' }}>
        <h2 style={{ marginBottom: '1rem' }}>Step 1: Stream Type</h2>
        <div className="field-group" style={{ marginBottom: "1.5rem" }}>
          <label style={{ marginBottom: "0.5rem", display: "block" }}>Type of Stream</label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {['one-time', 'recurring', 'cliff', 'step-vesting'].map(type => (
              <button
                key={type}
                type="button"
                className={values.streamType === type ? "btn-primary" : "btn-ghost"}
                onClick={() => setValues(prev => ({ ...prev, streamType: type }))}
              >
                {type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>
        
        <div className="field-group" style={{ marginBottom: "1.5rem" }}>
          <label style={{ marginBottom: "0.5rem", display: "block" }}>Recipients Setup</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className={streamMode === "single" ? "btn-primary" : "btn-ghost"}
              onClick={() => setStreamMode("single")}
              aria-pressed={streamMode === "single"}
            >
              Single Recipient
            </button>
            <button
              type="button"
              className={streamMode === "split" ? "btn-primary" : "btn-ghost"}
              onClick={() => setStreamMode("split")}
              aria-pressed={streamMode === "split"}
            >
              Split Stream
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: currentStep === 2 ? 'block' : 'none' }}>
        <h2 style={{ marginBottom: '1rem' }}>Step 2: Recipient, Asset & Amount</h2>
      {/* Sender */}
      <div
        className={`field-group${errors.sender ? " field-group--error" : ""}`}
      >
        <label htmlFor="stream-sender">
          Sender Account
          <span className="field-required" aria-hidden>
            *
          </span>
        </label>
        <input
          id="stream-sender"
          type="text"
          value={values.sender}
          onChange={set("sender")}
          onBlur={blur("sender")}
          placeholder="G… (56-character Stellar public key)"
          aria-describedby={errors.sender ? "sender-error" : "sender-hint"}
          aria-invalid={!!errors.sender}
          autoComplete="off"
          spellCheck={false}
        />
        <AccountHint value={values.sender} />
        {errors.sender && (
          <span id="sender-error" className="field-error" role="alert">
            {errors.sender}
          </span>
        )}
      </div>

      {/* Recipient — Single mode only */}
      {streamMode === "single" && (
        <div
          className={`field-group${errors.recipient ? " field-group--error" : ""}`}
        >
          <label htmlFor="stream-recipient">
            Recipient Account
            <span className="field-required" aria-hidden>
              *
            </span>
          </label>
          <input
            id="stream-recipient"
            type="text"
            value={values.recipient}
            onChange={set("recipient")}
            onBlur={blur("recipient")}
            placeholder="G… (56-character Stellar public key)"
            aria-describedby={
              errors.recipient ? "recipient-error" : "recipient-hint"
            }
            aria-invalid={!!errors.recipient}
            autoComplete="off"
            spellCheck={false}
          />
          <AccountHint value={values.recipient} />
          {errors.recipient && (
            <span id="recipient-error" className="field-error" role="alert">
              {errors.recipient}
            </span>
          )}
        </div>
      )}

      {/* Split Recipients */}
      {streamMode === "split" && (
        <div className="field-group" style={{ marginBottom: "1rem" }}>
          <label style={{ marginBottom: "0.5rem", display: "block" }}>
            Recipients & Allocations
            <span className="field-required" aria-hidden> *</span>
          </label>
          {splitRecipients.map((recipient, index) => (
            <div key={index} className="row" style={{ marginBottom: "0.5rem", alignItems: "flex-start" }}>
              <div style={{ flex: 3 }}>
                <input
                  type="text"
                  value={recipient.address}
                  onChange={(e) => updateSplitRecipient(index, "address", e.target.value)}
                  placeholder={`Recipient ${index + 1} (G…)`}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Split recipient ${index + 1} address`}
                />
                <AccountHint value={recipient.address} />
              </div>
              <div style={{ flex: 1, minWidth: "80px" }}>
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={recipient.percentage}
                  onChange={(e) => updateSplitRecipient(index, "percentage", e.target.value)}
                  aria-label={`Split recipient ${index + 1} percentage`}
                />
                <span className="field-hint">%</span>
              </div>
              {splitRecipients.length > 2 && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => removeSplitRecipient(index)}
                  aria-label={`Remove recipient ${index + 1}`}
                  style={{ padding: "0.5rem" }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
            <span className="field-hint">
              Total: {splitRecipients.reduce((sum, r) => sum + Number(r.percentage || 0), 0).toFixed(1)}% / 100%
            </span>
            {splitRecipients.length < 10 && (
              <button
                type="button"
                className="btn-ghost"
                onClick={addSplitRecipient}
              >
                + Add Recipient
              </button>
            )}
          </div>
          {splitErrors && (
            <span className="field-error" role="alert" style={{ marginTop: "0.5rem", display: "block" }}>
              {splitErrors}
            </span>
          )}
          {splitValidationError && submitAttempted && !splitErrors && (
            <span className="field-error" role="alert" style={{ marginTop: "0.5rem", display: "block" }}>
              {splitValidationError}
            </span>
          )}
        </div>
      )}

      {/* Asset & Total Amount */}
      <div className="row">
        <div
          className={`field-group${errors.assetCode ? " field-group--error" : ""}`}
        >
          <label htmlFor="stream-asset">
            Asset Code
            <span className="field-required" aria-hidden>
              *
            </span>
          </label>
          {!configFetchFailed && allowedAssets.length > 0 ? (
            <select
              id="stream-asset"
              value={values.assetCode}
              onChange={set("assetCode")}
              onBlur={blur("assetCode")}
              aria-describedby={errors.assetCode ? "asset-error" : "asset-hint"}
              aria-invalid={!!errors.assetCode}
              required
            >
              {allowedAssets.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="stream-asset"
              type="text"
              value={values.assetCode}
              onChange={set("assetCode")}
              onBlur={blur("assetCode")}
              placeholder="e.g. USDC"
              aria-describedby={errors.assetCode ? "asset-error" : "asset-hint"}
              aria-invalid={!!errors.assetCode}
              required
            />
          )}
          {errors.assetCode && (
            <span id="asset-error" className="field-error" role="alert">
              {errors.assetCode}
            </span>
          )}
        </div>

        <div
          className={`field-group${errors.totalAmount ? " field-group--error" : ""}`}
        >
          <label htmlFor="stream-amount">
            Total Amount
            <span className="field-required" aria-hidden>
              *
            </span>
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
              if (["e", "E", "+"].includes(e.key)) e.preventDefault();
            }}
            aria-describedby={errors.totalAmount ? "amount-error" : "amount-hint"}
            aria-invalid={!!errors.totalAmount}
            required
          />
          <span id="amount-hint" className="field-hint">
            Enter a positive number
          </span>
          {errors.totalAmount && (
            <span id="amount-error" className="field-error" role="alert">
              {errors.totalAmount}
            </span>
          )}
        </div>
      </div>
      </div>

      <div style={{ display: currentStep === 3 ? 'block' : 'none' }}>
        <h2 style={{ marginBottom: '1rem' }}>Step 3: Duration & Schedule</h2>
      {/* Duration & Start In Minutes */}
      <div className="row">
        <div
          className={`field-group${errors.durationMinutes ? " field-group--error" : ""}`}
        >
          <label htmlFor="stream-duration">
            Duration (minutes)
            <span className="field-required" aria-hidden>
              *
            </span>
          </label>
          <input
            id="stream-duration"
            type="number"
            min="1"
            step="1"
            value={values.durationMinutes}
            onChange={set("durationMinutes")}
            onBlur={blur("durationMinutes")}
            onKeyDown={(e) => {
              if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
            }}
            aria-describedby={
              errors.durationMinutes ? "duration-error" : (estimatedEndLabel ? "duration-hint" : undefined)
            }
            aria-invalid={!!errors.durationMinutes}
            required
          />
          {estimatedEndLabel && (
            <span id="duration-hint" className="field-hint" aria-live="polite">
              {estimatedEndLabel}
            </span>
          )}
          {errors.durationMinutes && (
            <span id="duration-error" className="field-error" role="alert">
              {errors.durationMinutes}
            </span>
          )}
        </div>

        <div
          className={`field-group${errors.startInMinutes ? " field-group--error" : ""}`}
        >
          <label htmlFor="stream-start">
            Start In (minutes)
            <span className="field-required" aria-hidden>
              *
            </span>
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
              errors.startInMinutes ? "start-error" : "start-hint"
            }
            aria-invalid={!!errors.startInMinutes}
            required
          />
          <span id="start-hint" className="field-hint">
            Enter 0 to start immediately
          </span>
          {errors.startInMinutes && (
            <span id="start-error" className="field-error" role="alert">
              {errors.startInMinutes}
            </span>
          )}
        </div>
      </div>

      {/* Cliff Period */}
      <div
        className={`field-group${errors.cliffDays ? " field-group--error" : ""}`}
      >
        <label htmlFor="stream-cliff">
          Cliff Period (days)
        </label>
        <input
          id="stream-cliff"
          type="number"
          min="0"
          step="1"
          value={values.cliffDays}
          onChange={set("cliffDays")}
          onBlur={blur("cliffDays")}
          onKeyDown={(e) => {
            if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
          }}
          aria-describedby={
            errors.cliffDays ? "cliff-error" : "cliff-hint"
          }
          aria-invalid={!!errors.cliffDays}
        />
        <span id="cliff-hint" className="field-hint">
          Optional. No tokens vest before the cliff elapses.
        </span>
        {errors.cliffDays && (
          <span id="cliff-error" className="field-error" role="alert">
            {errors.cliffDays}
          </span>
        )}
      </div>

      {estimatedEndLabel && (
        <div className="field-hint" style={{ marginTop: "-0.5rem", marginBottom: "1rem", color: "var(--color-success-text, #2e7d32)", fontWeight: 500 }}>
          {estimatedEndLabel}
        </div>
      )}
      </div>

      <div style={{ display: currentStep === 4 ? 'block' : 'none' }}>
        <h2 style={{ marginBottom: '1rem' }}>Step 4: Review and Sign</h2>
        <div className="review-box" style={{ background: 'var(--color-bg-secondary, #f8f9fa)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
          <p><strong>Type:</strong> {values.streamType} ({streamMode})</p>
          <p><strong>Sender:</strong> {values.sender || 'Missing'}</p>
          {streamMode === 'single' ? (
            <p><strong>Recipient:</strong> {values.recipient || 'Missing'}</p>
          ) : (
            <p><strong>Recipients:</strong> {splitRecipients.length} configured</p>
          )}
          <p><strong>Asset:</strong> {values.assetCode}</p>
          <p><strong>Total Amount:</strong> {values.totalAmount}</p>
          <p><strong>Duration:</strong> {values.durationMinutes} minutes</p>
          <p><strong>Starts In:</strong> {values.startInMinutes} minutes</p>
          {values.cliffDays && values.cliffDays !== '0' && <p><strong>Cliff:</strong> {values.cliffDays} days</p>}
          {estimatedEndLabel && <p style={{ color: "var(--color-success-text, #2e7d32)" }}>{estimatedEndLabel}</p>}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "2rem" }}>
        {simulationError && (
          <span className="field-error" role="alert" style={{ position: "absolute", marginTop: "-3rem" }}>
            {simulationError}
          </span>
        )}
        
        {currentStep > 1 ? (
          <button type="button" className="btn-ghost" onClick={handlePrev} disabled={isSubmitting}>
            Back
          </button>
        ) : <div />}
        
        {currentStep < 4 ? (
          <button type="button" className="btn-primary" onClick={handleNext}>
            Next
          </button>
        ) : (
          <button
            className="btn-primary"
            type="submit"
            disabled={isSubmitting || (streamMode === "single" ? !formValid : !isSplitValid)}
            aria-busy={isSubmitting}
          >
            {isSubmitting
              ? (streamMode === "split" ? "Creating..." : "Estimating fee...")
              : (streamMode === "split" ? "Create Split Stream" : "Create Stream")}
          </button>
        )}
      </div>
    </form>
    {feePreview && (
      <div className="modal-backdrop" role="presentation">
        <div
          className="modal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fee-preview-title"
        >
          <div className="modal-header">
            <h3 id="fee-preview-title" className="modal-title">
              Confirm stream creation
            </h3>
            <button
              type="button"
              className="modal-close"
              aria-label="Cancel fee preview"
              onClick={() => setFeePreview(null)}
              disabled={isSubmitting}
            >
              x
            </button>
          </div>

          <dl className="fee-preview-list">
            <div>
              <dt>Total amount</dt>
              <dd>
                {feePreview.payload.totalAmount} {feePreview.payload.assetCode}
              </dd>
            </div>
            <div>
              <dt>Stream rate</dt>
              <dd>{formatStreamRate(feePreview.payload)}</dd>
            </div>
            <div>
              <dt>Network fee estimate</dt>
              <dd>{feePreview.estimate.feeXlm} XLM</dd>
            </div>
          </dl>

          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setFeePreview(null)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void confirmCreateStream()}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Creating..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
