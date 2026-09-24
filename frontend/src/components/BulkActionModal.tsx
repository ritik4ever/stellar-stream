import { useFocusTrap } from "../hooks/useFocusTrap";

export type BulkActionType = "cancel" | "pause" | "resume";

export interface BulkActionFailure {
  streamId: string;
  message: string;
}

export interface BulkActionState {
  action: BulkActionType;
  phase: "confirm" | "running" | "complete";
  progress: { current: number; total: number };
  failures: BulkActionFailure[];
}

interface BulkActionModalProps {
  state: BulkActionState;
  onConfirm: () => void;
  onClose: () => void;
}

const ACTION_LABELS: Record<BulkActionType, { verb: string; gerund: string }> = {
  cancel: { verb: "Cancel", gerund: "Canceling" },
  pause: { verb: "Pause", gerund: "Pausing" },
  resume: { verb: "Resume", gerund: "Resuming" },
};

export function BulkActionModal({ state, onConfirm, onClose }: BulkActionModalProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const { action, phase, progress, failures } = state;
  const { verb, gerund } = ACTION_LABELS[action];
  const isRunning = phase === "running";
  const isComplete = phase === "complete";
  const successCount = progress.total - failures.length;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRunning) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-action-title"
      >
        <h2 id="bulk-action-title">
          {verb} {progress.total} stream{progress.total !== 1 ? "s" : ""}?
        </h2>

        {phase === "confirm" && (
          <p>
            This will {action} {progress.total} selected stream
            {progress.total !== 1 ? "s" : ""} one at a time.
          </p>
        )}

        {isRunning && (
          <p className="muted" role="status" aria-live="polite">
            {gerund} {progress.current} of {progress.total}
          </p>
        )}

        {isComplete && (
          <div role="status" aria-live="polite">
            <p>
              {successCount} of {progress.total} stream
              {progress.total !== 1 ? "s" : ""} succeeded.
            </p>
            {failures.length > 0 && (
              <ul className="claim-batch-failures" aria-label={`${action} failures`}>
                {failures.map((f) => (
                  <li key={f.streamId}>
                    Stream {f.streamId}: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="modal-actions">
          {phase === "confirm" && (
            <>
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={onConfirm}>
                Confirm {verb.toLowerCase()}
              </button>
            </>
          )}
          {isRunning && (
            <button type="button" className="btn-primary" disabled aria-busy="true">
              {gerund}…
            </button>
          )}
          {isComplete && (
            <button type="button" className="btn-primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}