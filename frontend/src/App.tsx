import { useEffect, useMemo, useState, type RefObject } from "react";
import { CreateStreamForm } from "./components/CreateStreamForm";
import { EditStartTimeModal } from "./components/EditStartTimeModal";
import { IssueBacklog } from "./components/IssueBacklog";
import { OfflineBanner } from "./components/OfflineBanner";
import { RecipientDashboard } from "./components/RecipientDashboard";
import { SenderDashboard } from "./components/SenderDashboard";
import { StreamDetailDrawer } from "./components/StreamDetailDrawer";
import { StreamMetricsChart } from "./components/StreamMetricsChart";
import { StreamTimeline } from "./components/StreamTimeline";
import { StreamsTable } from "./components/StreamsTable";
import { WalletButton } from "./components/WalletButton";
import { useFreighter } from "./hooks/useFreighter";
import { useMetricsHistory, type TimeRange } from "./hooks/useMetricsHistory";
import { defaultStreamFilters, useStreamFilter } from "./hooks/useStreamFilter";
import { useToast } from "./hooks/useToast";
import { useWebSocket } from "./hooks/useWebSocket";
import {
  ApiError,
  cancelStream,
  createStream,
  listOpenIssues,
  listStreams,
  pauseStream,
  resumeStream,
  updateStreamStartAt,
} from "./services/api";
import { ListStreamsFilters } from "./services/api";
import { OpenIssue, Stream } from "./types/stream";

type ViewMode = "dashboard" | "recipient" | "sender";

function App() {
  const wallet = useFreighter();
  const { showToast } = useToast();

  // ── ISSUE #159: Dark Mode Logic (LocalStorage + System Preference) ─────────────────
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');
  // ───────────────────────────────────────────────────────────────────────────────────

  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [detailStreamId, setDetailStreamId] = useState<string | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingStream, setEditingStream] = useState<{
    stream: Stream;
    triggerRef: RefObject<HTMLButtonElement | null>;
  } | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);

  const { filters, filteredStreams, setFilter } = useStreamFilter(streams);
  const wsUrl = import.meta.env.VITE_WS_URL ?? "";
  const { lastMessage } = useWebSocket<{
    eventType?: string;
    type?: string;
    status?: string;
    streamId?: string;
  }>(wsUrl);

  const apiFilters: ListStreamsFilters = useMemo(
    () => ({
      status: filters.status,
      sender: filters.sender,
      recipient: filters.recipient,
      asset: filters.assetCode,
    }),
    [filters],
  );

  const tableFilters: ListStreamsFilters = useMemo(
    () => ({
      status: filters.status,
      sender: filters.sender,
      recipient: filters.recipient,
      asset: filters.assetCode,
      q: "",
    }),
    [filters],
  );


  const metrics = useMemo(() => {
    const activeCount = filteredStreams.filter(
      (s) => s.progress.status === "active",
    ).length;
    const completedCount = filteredStreams.filter(
      (s) => s.progress.status === "completed",
    ).length;
    const totalVested = filteredStreams.reduce(
      (sum, s) => sum + s.progress.vestedAmount,
      0,
    );
    return {
      total: filteredStreams.length,
      active: activeCount,
      completed: completedCount,
      vested: Number(totalVested.toFixed(2)),
    };
  }, [filteredStreams]);

  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const metricsHistoryState = useMetricsHistory(timeRange);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawView = params.get("view");
    const rawStreamId = params.get("streamId");
    if (rawView === "dashboard" || rawView === "sender" || rawView === "recipient") {
      setViewMode(rawView);
    }
    setDetailStreamId(rawStreamId);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (viewMode === "dashboard") {
      params.delete("view");
    } else {
      params.set("view", viewMode);
    }
    if (detailStreamId) {
      params.set("streamId", detailStreamId);
    } else {
      params.delete("streamId");
    }
    const next = params.toString();
    window.history.replaceState(
      null,
      "",
      next ? `${window.location.pathname}?${next}` : window.location.pathname,
    );
  }, [detailStreamId, viewMode]);

  async function refreshStreams(currentFilters: ListStreamsFilters): Promise<void> {
    const data = await listStreams(currentFilters);
    setStreams(data);
  }

  useEffect(() => {
    setLoadingDashboard(true);
    refreshStreams(apiFilters)
      .catch((err: unknown) => {
        const message =
          err instanceof ApiError
            ? `Failed loading streams (${err.statusCode})`
            : "Failed loading streams";
        showToast(message, "error");
      })
      .finally(() => {
        setInitialLoading(false);
        setLoadingDashboard(false);
      });
  }, [apiFilters, showToast]);

  useEffect(() => {
    listOpenIssues()
      .then(setIssues)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!lastMessage) return;
    const eventKind = lastMessage.eventType ?? lastMessage.type ?? "";
    if (!eventKind) return;

    if (eventKind.includes("created")) {
      showToast("Stream created", "success");
    } else if (eventKind.includes("cancel")) {
      showToast("Stream canceled", "info");
    } else if (eventKind.includes("complete")) {
      showToast("Stream completed", "success");
    }
    refreshStreams(apiFilters).catch(() => undefined);
  }, [apiFilters, lastMessage, showToast]);

  async function handleCreate(
    payload: Parameters<typeof createStream>[0],
  ): Promise<void> {
    setFormError(null);
    try {
      await createStream(payload);
      await refreshStreams(apiFilters);
      showToast("Stream created successfully", "success");
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        showToast(`Create failed (${err.statusCode}): ${err.message}`, "error");
        return;
      }
      const fallback = err instanceof Error ? err.message : "Failed to create stream.";
      setFormError(fallback);
      showToast(fallback, "error");
    }
  }

  async function handleCancel(streamId: string): Promise<void> {
    try {
      await cancelStream(streamId);
      await refreshStreams(apiFilters);
      showToast("Stream canceled", "info");
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`Cancel failed (${err.statusCode}): ${err.message}`, "error");
        return;
      }
      showToast(
        err instanceof Error ? err.message : "Failed to cancel the stream.",
        "error",
      );
    }
  }

  async function handlePause(streamId: string): Promise<void> {
    try {
      await pauseStream(streamId);
      await refreshStreams(apiFilters);
      showToast("Stream paused", "info");
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`Pause failed (${err.statusCode}): ${err.message}`, "error");
        return;
      }
      showToast(err instanceof Error ? err.message : "Failed to pause the stream.", "error");
    }
  }

  async function handleResume(streamId: string): Promise<void> {
    try {
      await resumeStream(streamId);
      await refreshStreams(apiFilters);
      showToast("Stream resumed", "success");
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`Resume failed (${err.statusCode}): ${err.message}`, "error");
        return;
      }
      showToast(err instanceof Error ? err.message : "Failed to resume the stream.", "error");
    }
  }

  async function handleUpdateStartTime(streamId: string, nextStartAt: number) {
    try {
      await updateStreamStartAt(streamId, nextStartAt);
      await refreshStreams(apiFilters);
      showToast("Start time updated", "success");
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`Update failed (${err.statusCode}): ${err.message}`, "error");
        return;
      }
      showToast("Failed to update stream start time", "error");
    }
  }

  if (initialLoading && viewMode === "dashboard") {
    return <div className="app-shell">Loading dashboard…</div>;
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">Soroban-native MVP</p>
            <h1>StellarStream</h1>
          </div>
          
          {/* ── ISSUE #159: Theme Toggle Button ── */}
          <button 
            type="button" 
            className="btn-ghost" 
            onClick={toggleTheme}
            style={{ marginRight: '0.5rem', fontSize: '1.2rem', minHeight: '36px', display: 'flex', alignItems: 'center' }}
            aria-label="Toggle Dark Mode"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          {/* ───────────────────────────────────── */}

          <WalletButton wallet={wallet} />
        </div>
        <p className="hero-copy">
          Continuous on-chain style payments for salaries, subscriptions, and
          freelancer payouts on Stellar.
        </p>
      </header>

      <nav className="app-nav" aria-label="Main">
        <button
          type="button"
          className={`app-nav-link ${viewMode === "dashboard" ? "app-nav-link--active" : ""}`}
          onClick={() => setViewMode("dashboard")}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={`app-nav-link ${viewMode === "sender" ? "app-nav-link--active" : ""}`}
          onClick={() => setViewMode("sender")}
        >
          Sender dashboard
        </button>
        <button
          type="button"
          className={`app-nav-link ${viewMode === "recipient" ? "app-nav-link--active" : ""}`}
          onClick={() => setViewMode("recipient")}
        >
          Recipient dashboard
        </button>
      </nav>

      <OfflineBanner />

      {viewMode === "sender" ? (
        <SenderDashboard
          senderAddress={wallet.address}
          onEditStartTime={(stream) =>
            setEditingStream({ stream, triggerRef: { current: null } })
          }
        />
      ) : viewMode === "recipient" ? (
        <RecipientDashboard recipientAddress={wallet.address} />
      ) : (
        <>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 className="chart-section__title" style={{ margin: 0 }}>Stream Metrics Trends</h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(["7d", "30d", "all"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTimeRange(r)}
                    style={{
                      padding: "0.25rem 0.75rem",
                      fontSize: "0.875rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #4b5563",
                      backgroundColor: timeRange === r ? "#3b82f6" : "transparent",
                      color: "#f3f4f6",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {metricsHistoryState.loading ? (
              <div style={{ height: "400px", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af" }}>
                Loading metrics history...
              </div>
            ) : (
              <StreamMetricsChart data={metricsHistoryState.data || []} />
            )}
          </section>

          <section className="layout-grid">
            <CreateStreamForm
              onCreate={handleCreate}
              apiError={formError}
              walletAddress={wallet.address}
            />
            <StreamsTable
              streams={filteredStreams}
              filters={tableFilters}
              onFiltersChange={(next) => {
                setFilter("status", next.status ?? defaultStreamFilters.status);
                setFilter("sender", next.sender ?? defaultStreamFilters.sender);
                setFilter("recipient", next.recipient ?? defaultStreamFilters.recipient);
                setFilter("assetCode", next.asset ?? defaultStreamFilters.assetCode);
              }}
              onCancel={handleCancel}
              onPause={handlePause}
              onResume={handleResume}
              onEditStartTime={(stream, triggerRef) =>
                setEditingStream({ stream, triggerRef })
              }
              onOpenStream={setDetailStreamId}
            />
          </section>

          <IssueBacklog issues={issues} loading={loadingDashboard} />

          <section className="card" style={{ marginTop: "1rem" }}>
            <h2 style={{ marginBottom: "1rem" }}>Recent Activity</h2>
            <StreamTimeline />
          </section>

          {editingStream && (
            <EditStartTimeModal
              stream={editingStream.stream}
              triggerRef={editingStream.triggerRef}
              onConfirm={handleUpdateStartTime}
              onClose={() => setEditingStream(null)}
            />
          )}

          {detailStreamId && (
            <StreamDetailDrawer
              streamId={detailStreamId}
              onClose={() => setDetailStreamId(null)}
              onCancel={handleCancel}
            />
          )}
        </>
      )}
    </div>
  );
}

export default App;