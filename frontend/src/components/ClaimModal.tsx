import { useEffect, useMemo, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { estimateClaimFee } from "../services/soroban";
import { createClaimAmountSchema } from "../validation/schemas";

interface ClaimModalProps {
  streamId: string;
  recipientAddress: string;
  claimableAmount: number;
  assetCode: string;
  isSubmitting: boolean;
  onConfirm: (amount: number) => void;
  onClose: () => void;
}

type PresetPercentage = 25 | 50 | 75 | 100;

const PRESETS: { label: string; percentage: PresetPercentage }[] = [
  { label: "25%", percentage: 25 },
  { label: "50%", percentage: 50 },
  { label: "75%", percentage: 75 },
  { label: "Max", percentage: 100 },
];

// Contract amounts are integers (see toContractI128Amount in services/soroban.ts).
function roundToClaimPrecision(value: number): number {
  return Math.floor(value);
}

export function ClaimModal({
  streamId,
  recipientAddress,
  claimableAmount,
  assetCode,
  isSubmitting,
  onConfirm,
  onClose,
}: ClaimModalProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const [amountInput, setAmountInput] = useState(String(claimableAmount));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [feeState, setFeeState] = useState
    | { status: "loading" }
    | { status: "ready"; feeXlm: number }
    | { status: "error"; message: string }
  >({ status: "loading" });

  const amountSchema = useMemo(
    () => createClaimAmountSchema(claimableAmount),
    [claimableAmount],
  );

  const parseResult = amountSchema.safeParse(amountInput);
  const isAmountValid = parseResult.success;

  useEffect(() => {
    let active = true;
    setFeeState({ status: "loading" });

    estimateClaimFee(streamId, recipientAddress, claimableAmount)
      .then((estimate) => {
        if (active) setFeeState({ status: "ready", feeXlm: estimate.feeXlm });
      })
      .catch((err) => {
        if (active) {
          setFeeState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Could not estimate network fee.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [streamId, recipientAddress, claimableAmount]);

  function handlePreset(percentage: PresetPercentage) {
    const next =
      percentage === 100
        ? claimableAmount
        : roundToClaimPrecision((claimableAmount * percentage) / 100);
    setAmountInput(String(next));
    setValidationError(null);
  }

  function handleAmountChange(value: string) {
    setAmountInput(value);
    const result = amountSchema.safeParse(value);
    setValidationError(
      result.success ? null : result.error.issues[0]?.message ?? "Invalid amount.",
    );
  }

  function handleConfirm() {
    const result = amountSchema.safeParse(amountInput);
    if (!result.success) {
      setValidationError(result.error.issues[0]?.message ?? "Invalid amount.");
      return;
    }
    onConfirm(result.data);
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-modal-title"
      >
        <h2 id="claim-modal-title">Claim from stream {streamId}</h2>

        <p className="muted">
          Claimable balance: <strong>{claimableAmount} {assetCode}</strong>
        </p>

        <div className="claim-modal-presets" role="group" aria-label="Amount presets">
          {PRESETS.map(({ label, percentage }) => (
            <button
              key={label}
              type="button"
              className="btn-ghost"
              disabled={isSubmitting}
              onClick={() => handlePreset(percentage)}
            >
              {label}
            </button>
          ))}
        </div>

        <label htmlFor="claim-amount-input">Amount to claim</label>
        <input
          id="claim-amount-input"
          type="number"
          inputMode="decimal"
          min={0}
          max={claimableAmount}
          value={amountInput}
          disabled={isSubmitting}
          aria-describedby={validationError ? "claim-amount-error" : undefined}
          aria-invalid={Boolean(validationError)}
          onChange={(e) => handleAmountChange(e.target.value)}
        />
        {validationError && (
          <p id="claim-amount-error" className="field-error" role="alert">
            {validationError}
          </p>
        )}

        <div className="claim-modal-fee" role="status" aria-live="polite">
          {feeState.status === "loading" && (
            <span className="muted">Estimating network fee…</span>
          )}
          {feeState.status === "ready" && (
            <span className="muted">
              Estimated network fee: ~{feeState.feeXlm.toFixed(7)} XLM
            </span>
          )}
          {feeState.status === "error" && (
            <span className="muted">
              Network fee estimate unavailable ({feeState.message})
            </span>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" disabled={isSubmitting} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={isSubmitting || !isAmountValid}
            aria-busy={isSubmitting}
            onClick={handleConfirm}
          >
            {isSubmitting ? "Claiming…" : "Confirm claim"}
          </button>
        </div>
      </div>
    </div>
  );
}