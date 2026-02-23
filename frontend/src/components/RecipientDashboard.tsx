import { useEffect, useState } from "react";
import { listStreams } from "../services/api";
import { Stream } from "../types/stream";

interface RecipientDashboardProps {
  /** Connected wallet address (recipient account). When null, user must connect. */
  recipientAddress: string | null;
}

function statusClass(status: Stream["progress"]["status"]): string {
  switch (status) {
    case "active":
      return "badge badge-active";
    case "scheduled":
      return "badge badge-scheduled";
    case "completed":
      return "badge badge-completed";
    case "canceled":
      return "badge badge-canceled";
    default:
      return "badge";
  }
}

export function RecipientDashboard({ recipientAddress }: RecipientDashboardProps) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recipientAddress) {
      setLoading(false);
      setStreams([]);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    listStreams({ recipient: recipientAddress })
      .then((data) => {
        if (!active) return;
        setStreams(data);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load streams.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [recipientAddress]);

  // Not connected: prompt to connect wallet
  if (!recipientAddress) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <div className="recipient-dashboard-empty" role="status">
          <p className="muted">
            Connect your wallet to see streams where you are the recipient.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <div className="recipient-dashboard-loading" role="status" aria-busy="true">
          <div className="loading-spinner" aria-hidden />
          <p className="muted">Loading your streams…</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <div className="recipient-dashboard-error" role="alert">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const activeStreams = streams.filter(
    (s) => s.progress.status === "active" || s.progress.status === "scheduled",
  );
  const completedStreams = streams.filter(
    (s) => s.progress.status === "completed" || s.progress.status === "canceled",
  );

  const totalClaimable = activeStreams.reduce(
    (sum, s) => sum + s.progress.vestedAmount,
    0,
  );
  const totalClaimed = completedStreams.reduce(
    (sum, s) => sum + s.progress.vestedAmount,
    0,
  );

  // Empty state: no streams as recipient
  if (streams.length === 0) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <div className="recipient-dashboard-empty" role="status">
          <p className="muted">You have no streams as a recipient yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="recipient-dashboard">
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <p className="muted recipient-dashboard-subtitle">
          Streams where you are the recipient. Only your streams are shown.
        </p>

        <section className="recipient-dashboard-metrics">
          <article className="metric-card">
            <span>Active streams</span>
            <strong>{activeStreams.length}</strong>
          </article>
          <article className="metric-card">
            <span>Claimable</span>
            <strong>{Number(totalClaimable.toFixed(2))}</strong>
          </article>
          <article className="metric-card">
            <span>Completed streams</span>
            <strong>{completedStreams.length}</strong>
          </article>
          <article className="metric-card">
            <span>Claimed (completed)</span>
            <strong>{Number(totalClaimed.toFixed(2))}</strong>
          </article>
        </section>

        {activeStreams.length > 0 && (
          <section className="recipient-dashboard-section">
            <h3 className="recipient-dashboard-section-title">Active streams</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Asset</th>
                    <th>Claimable</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStreams.map((stream) => (
                    <tr key={stream.id}>
                      <td>
                        <span className="truncate-address">
                          {stream.sender.slice(0, 8)}…{stream.sender.slice(-4)}
                        </span>
                      </td>
                      <td>{stream.assetCode}</td>
                      <td>
                        <strong>
                          {stream.progress.vestedAmount} {stream.assetCode}
                        </strong>
                      </td>
                      <td>
                        {stream.totalAmount} {stream.assetCode}
                      </td>
                      <td>
                        <span className={statusClass(stream.progress.status)}>
                          {stream.progress.status}
                        </span>
                      </td>
                      <td>
                        <div className="progress-copy">
                          <strong>{stream.progress.percentComplete}%</strong>
                        </div>
                        <div className="progress-bar" aria-hidden>
                          <div
                            style={{
                              width: `${Math.min(stream.progress.percentComplete, 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {completedStreams.length > 0 && (
          <section className="recipient-dashboard-section">
            <h3 className="recipient-dashboard-section-title">
              Completed streams
            </h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Asset</th>
                    <th>Claimed</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {completedStreams.map((stream) => (
                    <tr key={stream.id}>
                      <td>
                        <span className="truncate-address">
                          {stream.sender.slice(0, 8)}…{stream.sender.slice(-4)}
                        </span>
                      </td>
                      <td>{stream.assetCode}</td>
                      <td>
                        <strong>
                          {stream.progress.vestedAmount} {stream.assetCode}
                        </strong>
                      </td>
                      <td>
                        {stream.totalAmount} {stream.assetCode}
                      </td>
                      <td>
                        <span className={statusClass(stream.progress.status)}>
                          {stream.progress.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
