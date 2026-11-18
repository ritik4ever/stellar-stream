import { useEffect, useMemo, useState, useCallback, useRef, type RefObject } from "react";
import { CreateStreamForm } from "../components/CreateStreamForm";
import { EditStartTimeModal } from "../components/EditStartTimeModal";
import { IssueBacklog } from "../components/IssueBacklog";
import { StreamDetailDrawer } from "../components/StreamDetailDrawer";
import { StreamMetricsChart } from "../components/StreamMetricsChart";
import { StreamTimeline } from "../components/StreamTimeline";
import { StreamsTable } from "../components/StreamsTable";
import { useFreighter, type FreighterState } from "../hooks/useFreighter";
import { useMetricsHistory } from "../hooks/useMetricsHistory";
import { defaultStreamFilters, useStreamFilter } from "../hooks/useStreamFilter";
import { useToast } from "../hooks/useToast";
import { useWebSocket } from "../hooks/useWebSocket";
import { useUrlFilters } from "../hooks/useUrlFilters";
import {
  ApiError,
  cancelStream,
  createStream,
  getWebSocketUrl,
  listOpenIssues,
  listStreams,
  pauseStream,
  resumeStream,
  updateStreamStartAt,
} from "../services/api";
import { ListStreamsFilters } from "../services/api";
import { OpenIssue, Stream } from "../types/stream";
import { StatsPanel } from "../components/StatsPanel";

export interface DashboardPageProps {
  wallet?: FreighterState;
}

export function DashboardPage({ wallet: propWallet }: DashboardPageProps) {
  const walletFromHook = useFreighter();
  const wallet = propWallet || walletFromHook;
  const { showToast } = useToast();
  const { filters: urlFilters, setFilters: setUrlFilters } = useUrlFilters();
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
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [streamLoadError, setStreamLoadError] = useState<string | null>(null);
  const [totalUnfilteredCount, setTotalUnfilteredCount] = useState<number>(0);
  const streamRequestId = useRef(0);
  const retryInFlight = useRef(false);
  const CREATE_STREAM_SECTION_ID = "create-stream-section";

  const scrollToCreateStream = useCallback(() => {
    document.getElementById(CREATE_STREAM_SECTION_ID)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const { filters, filteredStreams, setFilter } = useStreamFilter(streams);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const wsUrl = getWebSocketUrl();
  const { lastMessage } = useWebSocket<{
    eventType?: string;
    type?: string;
    status?: string;
    streamId?: string;
    vestedAmount?: number;
    percentComplete?: number;
  }>(wsUrl);

  const metricsHistory = useMetricsHistory("7d");

  const metrics = useMemo(
    () => {
      const active = streams.filter((stream) => stream.progress.status === "active").length;
      const completed = streams.filter((stream) => stream.progress.status === "completed").length;
      const vested = streams.reduce((sum, stream) => sum + stream.progress.vestedAmount, 0);

      return {
        total: totalUnfilteredCount,
        active,
        completed,
        vested,
      };
    },
    [streams, totalUnfilteredCount],
  );

  const apiFilters: ListStreamsFilters = useMemo(
    () => ({
      status: filters.status || urlFilters.status,
      sender: filters.sender || urlFilters.sender,
      recipient: filters.recipient || urlFilters.recipient,
      asset: filters.assetCode || urlFilters.asset,
      q: filters.q.trim() || undefined,
      sort: filters.sort || urlFilters.sort,
      page: filters.page > 1 ? filters.page : (urlFilters.page ?? undefined),
    }),
    [urlFilters, filters],
  );

  const tableFilters: ListStreamsFilters = useMemo(
    () => ({
      status: filters.status,
      sender: filters.sender,
      recipient: filters.recipient,
      asset: filters.assetCode,
      q: filters.q,
    }),
    [filters],
  );

  async function refreshStreams(currentFilters: ListStreamsFilters): Promise<void> {
    const requestId = ++streamRequestId.current;
    setLoadingStreams(true);
    setStreamLoadError(null);
    try {
      const result = await listStreams({ ...currentFilters, limit: 20 });
      if (requestId !== streamRequestId.current) return;
      setStreams(result.data);
      setHasMore(result.page * result.limit < result.total);
      setCurrentPage(result.page);
    } catch (err) {
      if (requestId !== streamRequestId.current) return;
      const message =
        err instanceof ApiError
          ? `Failed loading streams (${err.statusCode}). Check your connection and retry.`
          : "Failed loading streams. Check your connection and retry.";
      setStreamLoadError(message);
      showToast(message, "error");
    } finally {
      if (requestId === streamRequestId.current) {
        setLoadingStreams(false);
        setInitialLoading(false);
        setLoadingDashboard(false);
      }
    }
  }

  async function retryStreamLoad(): Promise<void> {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    try {
      await refreshStreams(apiFilters);
    } finally {
      retryInFlight.current = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const requestId = streamRequestId.current;
    try {
      const nextPage = currentPage + 1;
      const result = await listStreams({ ...apiFilters, page: nextPage, limit: 20 });
      if (requestId !== streamRequestId.current) return;
      setStreams((prev) => [...prev, ...result.data]);
      setHasMore(result.page * result.limit < result.total);
      setCurrentPage(result.page);
    } finally {
      setLoadingMore(false);
    }
  }

  async function refreshUnfilteredCount(): Promise<void> {
    try {
      const all = await listStreams({ limit: 1 });
      setTotalUnfilteredCount(all.total);
    } catch {
      // Ignore count errors; feature is best-effort.
    }
  }

  useEffect(() => {
    void refreshUnfilteredCount();
  }, []);

  useEffect(() => {
    setLoadingDashboard(true);
    void refreshStreams(apiFilters);
  }, [apiFilters, showToast]);

  useEffect(() => {
    listOpenIssues()
      .then(setIssues)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!lastMessage) return;
    const eventKind = lastMessage.type ?? "";
    if (!eventKind) return;

    if (eventKind === "stream_progress") {
      setStreams((prev) =>
        prev.map((stream) =>
          stream.id === lastMessage.streamId
            ? {
                ...stream,
                progress: {
                  ...stream.progress,
                  vestedAmount: lastMessage.vestedAmount ?? stream.progress.vestedAmount,
                  percentComplete: lastMessage.percentComplete ?? stream.progress.percentComplete,
                },
              }
            : stream,
        ),
      );
    } else {
      if (eventKind.includes("created")) {
        showToast("Stream created", "success");
      } else if (eventKind.includes("cancel")) {
        showToast("Stream canceled", "info");
      } else if (eventKind.includes("complete")) {
        showToast("Stream completed", "success");
      }

      void refreshStreams(apiFilters);
      void refreshUnfilteredCount();
    }
  }, [apiFilters, lastMessage, showToast]);

  async function handleCreate(
    payload: Parameters<typeof createStream>[0],
  ): Promise<void> {
    setFormError(null);
    try {
      await createStream(payload);
      await refreshStreams(apiFilters);
      void refreshUnfilteredCount();
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
      void refreshUnfilteredCount();
      showToast("Stream canceled", "info");
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(`Cancel failed (${err.statusCode}): ${err.message}`, "error");
        void refreshUnfilteredCount();
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
      void refreshUnfilteredCount();
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
      void refreshUnfilteredCount();
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
        void refreshUnfilteredCount();
        return;
      }
      showToast("Failed to update stream start time", "error");
    }
  }

  if (initialLoading) {
    return <div className="app-shell">Loading dashboard…</div>;
  }

  return (
    <>
      <StatsPanel
        total={metrics.total}
        active={metrics.active}
        completed={metrics.completed}
        vested={metrics.vested}
        loading={initialLoading}
        streamsLoading={loadingMore}
      />

      <section className="chart-section">
        <h2 className="chart-section__title">Stream Metrics Trends</h2>
        <StreamMetricsChart
          data={metricsHistory.data}
          loading={metricsHistory.loading}
          error={metricsHistory.error}
        />
      </section>

      <section className="layout-grid">
        <div id={CREATE_STREAM_SECTION_ID}>
          <CreateStreamForm
            onCreate={handleCreate}
            apiError={formError}
            walletAddress={wallet.address}
          />
        </div>
        <StreamsTable
          streams={filteredStreams}
          loading={loadingStreams}
          loadError={streamLoadError}
          onRetryLoad={retryStreamLoad}
          filters={tableFilters}
          totalStreamCount={totalUnfilteredCount}
          onCreateStream={scrollToCreateStream}
          onFiltersChange={(next) => {
            setFilter("status", next.status ?? defaultStreamFilters.status);
            setFilter("sender", next.sender ?? defaultStreamFilters.sender);
            setFilter("recipient", next.recipient ?? defaultStreamFilters.recipient);
            setFilter("assetCode", next.asset ?? defaultStreamFilters.assetCode);
            setFilter("q", next.q ?? defaultStreamFilters.q);
          }}
          setUrlFilters={setUrlFilters}
          onCancel={handleCancel}
          onPause={handlePause}
          onResume={handleResume}
          onEditStartTime={(stream, triggerRef) =>
            setEditingStream({ stream, triggerRef })
          }
          onOpenStream={setDetailStreamId}
          onLoadMore={loadMore}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onRefreshStreams={() => refreshStreams(apiFilters)}
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
          onPause={handlePause}
          onResume={handleResume}
          signAction={wallet.signAction}
          walletAddress={wallet.address}
        />
      )}
    </>
  );
}
