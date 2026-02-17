import { useEffect, useMemo, useState } from "react";
import { CreateStreamForm } from "./components/CreateStreamForm";
import { IssueBacklog } from "./components/IssueBacklog";
import { StreamsTable } from "./components/StreamsTable";
import { cancelStream, createStream, listOpenIssues, listStreams } from "./services/api";
import { OpenIssue, Stream } from "./types/stream";

function App() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refreshStreams(): Promise<void> {
    const data = await listStreams();
    setStreams(data);
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const [streamData, issueData] = await Promise.all([listStreams(), listOpenIssues()]);
        if (!active) {
          return;
        }
        setStreams(streamData);
        setIssues(issueData);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load initial data.");
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
    const activeCount = streams.filter((stream) => stream.progress.status === "active").length;
    const completedCount = streams.filter((stream) => stream.progress.status === "completed").length;
    const totalVested = streams.reduce((sum, stream) => sum + stream.progress.vestedAmount, 0);

    return {
      total: streams.length,
      active: activeCount,
      completed: completedCount,
      vested: Number(totalVested.toFixed(2)),
    };
  }, [streams]);

  async function handleCreate(payload: Parameters<typeof createStream>[0]): Promise<void> {
    try {
      setError(null);
      await createStream(payload);
      await refreshStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create stream.");
    }
  }

  async function handleCancel(streamId: string): Promise<void> {
    try {
      setError(null);
      await cancelStream(streamId);
      await refreshStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel stream.");
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Soroban-native MVP</p>
        <h1>StellarStream</h1>
        <p className="hero-copy">
          Continuous on-chain style payments for salaries, subscriptions, and freelancer payouts on Stellar.
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

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="layout-grid">
        <CreateStreamForm onCreate={handleCreate} />
        <StreamsTable streams={streams} onCancel={handleCancel} />
      </section>

      <IssueBacklog issues={issues} />
    </div>
  );
}

export default App;
