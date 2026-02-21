import { Stream } from "../types/stream";

interface StreamsTableProps {
  streams: Stream[];
  onCancel: (streamId: string) => Promise<void>;
  onEditStartTime: (stream: Stream) => void;
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

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

export function StreamsTable({ streams, onCancel, onEditStartTime }: StreamsTableProps) {
  if (streams.length === 0) {
    return (
      <div className="card">
        <h2>Live Streams</h2>
        <p className="muted">No streams yet. Create your first Stellar payment stream.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Live Streams</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Route</th>
              <th>Asset</th>
              <th>Progress</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {streams.map((stream) => {
              const isScheduled = stream.progress.status === "scheduled";
              const isFinalised =
                stream.progress.status === "completed" ||
                stream.progress.status === "canceled";

              return (
                <tr key={stream.id}>
                  <td>{stream.id}</td>
                  <td>
                    <div className="stacked">
                      <span>{stream.sender.slice(0, 8)}...</span>
                      <span>{stream.recipient.slice(0, 8)}...</span>
                    </div>
                  </td>
                  <td>
                    {stream.totalAmount} {stream.assetCode}
                    <div className="muted">Start: {formatTimestamp(stream.startAt)}</div>
                  </td>
                  <td>
                    <div className="progress-copy">
                      <strong>{stream.progress.percentComplete}%</strong>
                      <span className="muted">
                        Vested: {stream.progress.vestedAmount} {stream.assetCode}
                      </span>
                    </div>
                    <div className="progress-bar" aria-hidden>
                      <div style={{ width: `${Math.min(stream.progress.percentComplete, 100)}%` }} />
                    </div>
                  </td>
                  <td>
                    <span className={statusClass(stream.progress.status)}>
                      {stream.progress.status}
                    </span>
                  </td>
                  <td>
                    <div className="action-cell">
                      {isScheduled && (
                        <button
                          className="btn-ghost btn-edit"
                          type="button"
                          title="Edit start time"
                          onClick={() => onEditStartTime(stream)}
                        >
                          ✏️ Edit
                        </button>
                      )}
                      <button
                        className="btn-ghost"
                        type="button"
                        onClick={() => onCancel(stream.id)}
                        disabled={isFinalised}
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
