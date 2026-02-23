import { useEffect, useMemo, useState } from "react";
import { CreateStreamForm } from "./components/CreateStreamForm";
import { EditStartTimeModal } from "./components/EditStartTimeModal";
import { IssueBacklog } from "./components/IssueBacklog";
import { StreamsTable } from "./components/StreamsTable";
import { StreamMetricsChart } from "./components/StreamMetricsChart";
import { WalletButton } from "./components/WalletButton";
import { useFreighter } from "./hooks/useFreighter";
import {
  cancelStream,
  createStream,
  listOpenIssues,
  listStreams,
  updateStreamStartAt,
} from "./services/api";
import { OpenIssue, Stream } from "./types/stream";
import { useMetricsHistory } from "./hooks/useMetricsHistory";

// Derive a user-friendly hint string for global (non-form) errors.
function describeGlobalError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("failed to fetch")
  ) {
    return "Network error — check that the StellarStream backend is running and reachable.";
  }
  if (lower.includes("not found")) {
    return "The requested stream could not be found. It may have already been cancelled.";
  }
  if (lower.includes("cancel")) {
    return `Unable to cancel stream: ${raw}`;
  }
  return raw;
}

function App() {
  const wallet = useFreighter();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // The stream whose start-time is currently being edited (null = modal closed)
  const [editingStream, setEditingStream] = useState<Stream | null>(null);

  async function refreshStreams(): Promise<void> {
    const data = await listStreams();
    setStreams(data);
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const [streamData, issueData] = await Promise.all([
          listStreams(),
          listOpenIssues(),
        ]);
        if (!active) return;
        setStreams(streamData);
        setIssues(issueData);
      } catch (err) {
        if (!active) return;
        setGlobalError(
          err instanceof Error
            ? describeGlobalError(err.message)
            : "Failed to load initial data.",
        );
      }
    }

    void bootstrap();
    const timer = window.setInterval(() => {
      void refreshStreams();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const metrics = useMemo(() => {
    const activeCount = streams.filter(
      (s) => s.progress.status === "active",
    ).length;
    const completedCount = streams.filter(
      (s) => s.progress.status === "completed",
    ).length;
    const totalVested = streams.reduce(
      (sum, s) => sum + s.progress.vestedAmount,
      0,
    );

    return {
      total: streams.length,
      active: activeCount,
      completed: completedCount,
      vested: Number(totalVested.toFixed(2)),
    };
  }, [streams]);

  const metricsHistory = useMetricsHistory(
    metrics.active,
    metrics.completed,
    metrics.vested,
    5000,
  );

  async function handleCreate(
    payload: Parameters<typeof createStream>[0],
  ): Promise<void> {
    setFormError(null);
    setGlobalError(null);
    try {
      await createStream(payload);
      await refreshStreams();
    } catch (err) {
      // Surface form/create errors inline in the form, not as a global banner
      setFormError(
        err instanceof Error ? err.message : "Failed to create stream.",
      );
    }
  }

  async function handleCancel(streamId: string): Promise<void> {
    setGlobalError(null);
    setFormError(null);
    try {
      await cancelStream(streamId);
      await refreshStreams();
    } catch (err) {
      setGlobalError(
        err instanceof Error
          ? describeGlobalError(err.message)
          : "Failed to cancel the stream. Please try again.",
      );
    }
  }

  async function handleUpdateStartTime(
    streamId: string,
    newStartAt: number,
  ): Promise<void> {
    await updateStreamStartAt(streamId, newStartAt);
    await refreshStreams();
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">Soroban-native MVP</p>
            <h1>StellarStream</h1>
          </div>
          <WalletButton wallet={wallet} />
        </div>
        <p className="hero-copy">
          Continuous on-chain style payments for salaries, subscriptions, and
          freelancer payouts on Stellar.
        </p>
      </header>

      <section className="metric-grid">
        <article className="metric-card">
          <span>Total Streams</span>
          <strong>{metrics.total}</strong>
        </article>
        <article className="metric-card">
          <span>Active</span>
          <strong>{metrics.active}</strong>
        </article>
        <article className="metric-card">
          <span>Completed</span>
          <strong>{metrics.completed}</strong>
        </article>
        <article className="metric-card">
          <span>Total Vested</span>
          <strong>{metrics.vested}</strong>
        </article>
      </section>

      <section className="chart-section">
        <h2 className="chart-section__title">Stream Metrics Trends</h2>
        <StreamMetricsChart data={metricsHistory} />
      </section>

      {/* Global (cancel / bootstrap) errors shown as a dismissible banner */}
      {globalError && (
        <div className="error-banner" role="alert" aria-live="assertive">
          <span className="error-banner__icon" aria-hidden>
            ✕
          </span>
          <span>{globalError}</span>
          <button
            className="error-banner__dismiss"
            type="button"
            aria-label="Dismiss error"
            onClick={() => setGlobalError(null)}
          >
            ×
          </button>
        </div>
      )}

      <section className="layout-grid">
        {/* formError is passed into the form so the create-stream card can show it inline */}
        <CreateStreamForm
          onCreate={handleCreate}
          apiError={formError}
          walletAddress={wallet.address}
        />
        <StreamsTable
          streams={streams}
          onCancel={handleCancel}
          onEditStartTime={(stream) => setEditingStream(stream)}
        />
      </section>

      <IssueBacklog issues={issues} />

      {/* Edit start-time modal — only rendered when a stream is being edited */}
      {editingStream && (
        <EditStartTimeModal
          stream={editingStream}
          onConfirm={handleUpdateStartTime}
          onClose={() => setEditingStream(null)}
        />
      )}
    </div>
  );
}

export default App;
