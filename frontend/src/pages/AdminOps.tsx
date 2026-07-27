import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../hooks/useToast';
import {
  getAdminOpsCircuitBreakers,
  getAdminOpsQueueHealth,
  resetAdminOpsCircuitBreaker,
} from '../services/api';

interface CircuitBreakerStatus {
  portfolioId: string;
  state: string;
  healthy: boolean;
  isOpen: boolean;
  failureCount?: number;
  reason?: string | null;
  openedAt?: number | null;
  lastFailureAt?: number | null;
  lastSuccessAt?: number | null;
}

interface QueueHealth {
  backlogDepth: number;
  worker: {
    healthy: boolean;
    status: string;
    running: boolean;
    lastHeartbeatAt?: number | null;
    lastRunAt?: number | null;
    consecutiveErrors?: number;
  };
}

interface AdminOpsPageProps {
  isAdmin?: boolean;
}

const REFRESH_INTERVAL_MS = 15000;

function formatTimestamp(value?: number | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function getStateBadgeClass(state: string): string {
  const normalized = state.toUpperCase();
  if (normalized === 'OPEN' || normalized === 'TRIPPED') return 'badge badge-canceled';
  if (normalized === 'HALF_OPEN') return 'badge badge-paused';
  return 'badge badge-active';
}

export function AdminOpsPage({ isAdmin = true }: AdminOpsPageProps) {
  const { showToast } = useToast();
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreakerStatus[]>([]);
  const [queueHealth, setQueueHealth] = useState<QueueHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resettingPortfolio, setResettingPortfolio] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [circuitData, queueData] = await Promise.all([
        getAdminOpsCircuitBreakers(),
        getAdminOpsQueueHealth(),
      ]);
      setCircuitBreakers(circuitData);
      setQueueHealth(queueData ?? null);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load admin ops data';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void loadData();
    const intervalId = window.setInterval(() => {
      void loadData();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isAdmin, showToast]);

  const handleReset = async (portfolioId: string) => {
    if (resettingPortfolio) return;

    const shouldReset = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Reset circuit breaker for ${portfolioId}?`)
      : true;

    if (!shouldReset) return;

    setResettingPortfolio(portfolioId);
    try {
      const resetEntry = await resetAdminOpsCircuitBreaker(portfolioId);
      if (resetEntry) {
        setCircuitBreakers((prev) => prev.map((entry) => entry.portfolioId === portfolioId ? resetEntry : entry));
      } else {
        await loadData();
      }
      showToast('Circuit breaker reset successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reset circuit breaker';
      showToast(message, 'error');
    } finally {
      setResettingPortfolio(null);
    }
  };

  const openBreakers = useMemo(() => circuitBreakers.filter((breaker) => breaker.isOpen), [circuitBreakers]);

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="app-shell">
      <section className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <p className="eyebrow">Operations</p>
            <h2 style={{ margin: '0.15rem 0 0.35rem' }}>Admin Operations</h2>
            <p className="muted" style={{ margin: 0 }}>
              Monitor circuit breaker health and worker queue pressure in real time.
            </p>
          </div>
          <div className="badge badge-active">Auto-refreshing</div>
        </div>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          <span className="error-banner__icon">⚠</span>
          <span>{error}</span>
        </div>
      ) : null}

      <section className="layout-grid" style={{ gridTemplateColumns: '1.2fr 0.8fr' }}>
        <article className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.85rem' }}>
            <h3 style={{ margin: 0 }}>Circuit Breakers</h3>
            <span className="muted">{openBreakers.length} tripped</span>
          </div>

          {loading && circuitBreakers.length === 0 ? (
            <p className="muted">Loading circuit breaker state…</p>
          ) : circuitBreakers.length === 0 ? (
            <p className="muted">No circuit breaker data is currently available.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Portfolio</th>
                    <th>Status</th>
                    <th>Details</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {circuitBreakers.map((breaker) => (
                    <tr key={breaker.portfolioId}>
                      <td>
                        <strong>{breaker.portfolioId}</strong>
                      </td>
                      <td>
                        <span className={getStateBadgeClass(breaker.state)}>{breaker.state}</span>
                        {breaker.isOpen ? <div className="muted" style={{ marginTop: '0.2rem' }}>Tripped</div> : <div className="muted" style={{ marginTop: '0.2rem' }}>Healthy</div>}
                      </td>
                      <td>
                        <div className="stacked">
                          <span className="muted">Failures: {breaker.failureCount ?? 0}</span>
                          <span className="muted">Reason: {breaker.reason || '—'}</span>
                          <span className="muted">Opened: {formatTimestamp(breaker.openedAt)}</span>
                        </div>
                      </td>
                      <td>
                        {breaker.isOpen ? (
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => void handleReset(breaker.portfolioId)}
                            disabled={resettingPortfolio === breaker.portfolioId}
                          >
                            {resettingPortfolio === breaker.portfolioId ? 'Resetting…' : 'Reset Circuit Breaker'}
                          </button>
                        ) : (
                          <span className="muted">No action</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="card">
          <h3 style={{ margin: '0 0 0.85rem' }}>Queue & Worker Health</h3>
          {loading && !queueHealth ? (
            <p className="muted">Loading worker status…</p>
          ) : !queueHealth ? (
            <p className="muted">No queue health data is currently available.</p>
          ) : (
            <div className="stacked">
              <div className="metric-card">
                <span>Queue backlog</span>
                <strong>{queueHealth.backlogDepth}</strong>
              </div>
              <div className="metric-card">
                <span>Worker status</span>
                <strong>{queueHealth.worker.status}</strong>
              </div>
              <div className="metric-card">
                <span>Heartbeat</span>
                <strong>{queueHealth.worker.healthy ? 'Healthy' : 'Unhealthy'}</strong>
              </div>
              <div className="muted">Last heartbeat: {formatTimestamp(queueHealth.worker.lastHeartbeatAt)}</div>
              <div className="muted">Last run: {formatTimestamp(queueHealth.worker.lastRunAt)}</div>
              <div className="muted">Consecutive errors: {queueHealth.worker.consecutiveErrors ?? 0}</div>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
