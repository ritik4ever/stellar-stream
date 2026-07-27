import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { ToastProvider } from '../hooks/useToast';
import { AdminOpsPage } from './AdminOps';

const mockGetAdminOpsCircuitBreakers = vi.fn();
const mockGetAdminOpsQueueHealth = vi.fn();
const mockResetAdminOpsCircuitBreaker = vi.fn();

vi.mock('../services/api', () => ({
  getAdminOpsCircuitBreakers: () => mockGetAdminOpsCircuitBreakers(),
  getAdminOpsQueueHealth: () => mockGetAdminOpsQueueHealth(),
  resetAdminOpsCircuitBreaker: (portfolioId: string) => mockResetAdminOpsCircuitBreaker(portfolioId),
}));

function renderAdminOpsPage() {
  return render(
    <ToastProvider>
      <AdminOpsPage isAdmin={true} />
    </ToastProvider>,
  );
}

describe('AdminOpsPage', () => {
  beforeEach(() => {
    mockGetAdminOpsCircuitBreakers.mockReset();
    mockGetAdminOpsQueueHealth.mockReset();
    mockResetAdminOpsCircuitBreaker.mockReset();
    window.confirm = vi.fn(() => true) as typeof window.confirm;
  });

  it('renders a tripped circuit breaker state', async () => {
    mockGetAdminOpsCircuitBreakers.mockResolvedValue([
      {
        portfolioId: 'indexer',
        state: 'OPEN',
        healthy: false,
        isOpen: true,
        failureCount: 5,
        reason: 'Failure threshold reached',
        openedAt: 1710000000000,
        lastFailureAt: 1710000000000,
        lastSuccessAt: null,
      },
    ]);
    mockGetAdminOpsQueueHealth.mockResolvedValue({
      backlogDepth: 7,
      worker: {
        healthy: false,
        status: 'degraded',
        running: true,
        lastHeartbeatAt: 1710000000000,
        lastRunAt: 1710000000000,
        consecutiveErrors: 2,
      },
    });

    renderAdminOpsPage();

    expect(await screen.findByText(/Admin Operations/i)).toBeInTheDocument();
    expect(screen.getByText('indexer')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
    expect(screen.getByText('Tripped')).toBeInTheDocument();
  });

  it('resets a tripped circuit breaker', async () => {
    mockGetAdminOpsCircuitBreakers.mockResolvedValue([
      {
        portfolioId: 'indexer',
        state: 'OPEN',
        healthy: false,
        isOpen: true,
        failureCount: 5,
        reason: 'Failure threshold reached',
        openedAt: 1710000000000,
        lastFailureAt: 1710000000000,
        lastSuccessAt: null,
      },
    ]);
    mockGetAdminOpsQueueHealth.mockResolvedValue({
      backlogDepth: 4,
      worker: {
        healthy: true,
        status: 'healthy',
        running: true,
        lastHeartbeatAt: 1710000000000,
        lastRunAt: 1710000000000,
        consecutiveErrors: 0,
      },
    });
    mockResetAdminOpsCircuitBreaker.mockResolvedValue({
      portfolioId: 'indexer',
      state: 'CLOSED',
      healthy: true,
      isOpen: false,
      failureCount: 0,
      reason: null,
      openedAt: null,
      lastFailureAt: 1710000000000,
      lastSuccessAt: 1710000000000,
    });

    renderAdminOpsPage();

    fireEvent.click(await screen.findByRole('button', { name: /reset circuit breaker/i }));

    await waitFor(() => expect(mockResetAdminOpsCircuitBreaker).toHaveBeenCalledWith('indexer'));
    expect(await screen.findByText('CLOSED')).toBeInTheDocument();
  });
});
