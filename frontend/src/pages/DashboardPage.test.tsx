import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListStreamsFilters, PaginatedResult } from '../services/api';
import type { Stream } from '../types/stream';
import { DashboardPage } from './DashboardPage';

const { listStreamsMock, showToastMock, cancelStreamMock } = vi.hoisted(() => ({
  listStreamsMock: vi.fn(),
  showToastMock: vi.fn(),
  cancelStreamMock: vi.fn(),
}));

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    listStreams: listStreamsMock,
    listOpenIssues: vi.fn().mockResolvedValue([]),
    createStream: vi.fn(),
    cancelStream: cancelStreamMock,
    pauseStream: vi.fn(),
    resumeStream: vi.fn(),
    updateStreamStartAt: vi.fn(),
  };
});

vi.mock('../hooks/useFreighter', () => ({
  useFreighter: () => ({
    installed: false,
    allowed: false,
    address: null,
    status: 'idle',
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signAction: vi.fn(),
  }),
}));

vi.mock('../hooks/useMetricsHistory', () => ({
  useMetricsHistory: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ readyState: 0, lastMessage: null }),
}));

vi.mock('../components/CreateStreamForm', () => ({
  CreateStreamForm: () => null,
}));
vi.mock('../components/EditStartTimeModal', () => ({
  EditStartTimeModal: () => null,
}));
vi.mock('../components/IssueBacklog', () => ({ IssueBacklog: () => null }));
vi.mock('../components/StreamDetailDrawer', () => ({
  StreamDetailDrawer: () => null,
}));
vi.mock('../components/StreamMetricsChart', () => ({
  StreamMetricsChart: () => null,
}));
vi.mock('../components/StreamTimeline', () => ({ StreamTimeline: () => null }));
vi.mock('../components/StatsPanel', () => ({ StatsPanel: () => null }));
vi.mock('../components/StreamsTable', async () => {
  const { FilterBar } = await import('../components/FilterBar');
  return {
    StreamsTable: ({
      filters,
      onFiltersChange,
      streams,
      loading,
      loadError,
      onRetryLoad,
      onLoadMore,
      hasMore,
      loadingMore,
      loadMoreError,
      loadMoreStatus,
      onCancel,
    }: {
      filters: ListStreamsFilters;
      onFiltersChange: (filters: ListStreamsFilters) => void;
      streams: Stream[];
      loading: boolean;
      loadError?: string | null;
      onRetryLoad?: () => void;
      onLoadMore?: () => void;
      hasMore?: boolean;
      loadingMore?: boolean;
      loadMoreError?: string | null;
      loadMoreStatus?: string | null;
      onCancel?: (streamId: string) => Promise<void>;
    }) => (
      <div>
        <FilterBar filters={filters} onChange={onFiltersChange} />
        {loading && <span>Loading streams</span>}
        {loadError && (
          <div role="alert">
            <p>{loadError}</p>
            <button type="button" onClick={onRetryLoad} disabled={loading}>
              Retry
            </button>
          </div>
        )}
        {onLoadMore && (
          <>
            <div role="status" aria-live="polite" aria-atomic="true">
              {loadingMore
                ? 'Loading more streams...'
                : (loadMoreError ?? loadMoreStatus ?? '')}
            </div>
            {(hasMore || loadingMore) && (
              <button type="button" onClick={onLoadMore} disabled={loadingMore}>
                {loadMoreError ? 'Retry loading streams' : 'Load more streams'}
              </button>
            )}
          </>
        )}
        {streams.map((stream) => (
          <div key={stream.id}>
            {stream.id}
            <button type="button" onClick={() => void onCancel?.(stream.id)}>
              Cancel stream {stream.id}
            </button>
          </div>
        ))}
      </div>
    ),
  };
});

function makeStream(id: string): Stream {
  return {
    id,
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT',
    assetCode: 'USDC',
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1000,
    createdAt: 900,
    progress: {
      status: 'active',
      ratePerSecond: 1,
      elapsedSeconds: 100,
      vestedAmount: 10,
      remainingAmount: 90,
      percentComplete: 10,
    },
  };
}

function result(
  ids: string[],
  total = ids.length,
  page = 1,
  limit = 20,
): PaginatedResult<Stream> {
  return {
    data: ids.map(makeStream),
    total,
    page,
    limit,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderDashboard() {
  return render(
    <DashboardPage
      wallet={{
        installed: false,
        allowed: false,
        address: null,
        status: 'idle',
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        signAction: vi.fn(),
      }}
    />,
  );
}

describe('Dashboard stream search recovery', () => {
  beforeEach(() => {
    listStreamsMock.mockReset();
    listStreamsMock.mockResolvedValue(result([]));
    cancelStreamMock.mockReset().mockResolvedValue(undefined);
    window.history.replaceState(null, '', '/');
  });

  it('keeps whitespace-only searches unfiltered and mixed-case matches actionable', async () => {
    listStreamsMock.mockImplementation((filters?: ListStreamsFilters) => {
      if (filters?.q === 'sEnDeR')
        return Promise.resolve(result(['mixed-case-result']));
      return Promise.resolve(result(['whitespace-result']));
    });

    renderDashboard();
    const input = await screen.findByLabelText(/Search ID \/ Address/i);

    fireEvent.change(input, { target: { value: '   ', name: 'q' } });

    await screen.findByRole('button', {
      name: 'Cancel stream whitespace-result',
    });
    expect(input).toHaveValue('   ');
    expect(screen.getByText('whitespace-result')).toBeInTheDocument();
    expect(
      listStreamsMock.mock.calls.some(
        ([filters]) => filters?.limit === 20 && filters.q === undefined,
      ),
    ).toBe(true);
    expect(cancelStreamMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'sEnDeR', name: 'q' } });

    await screen.findByRole('button', {
      name: 'Cancel stream mixed-case-result',
    });
    expect(input).toHaveValue('sEnDeR');
    expect(screen.getByText('mixed-case-result')).toBeInTheDocument();
    expect(screen.queryByText('whitespace-result')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel stream mixed-case-result' }),
    );
    await waitFor(() =>
      expect(cancelStreamMock).toHaveBeenCalledWith('mixed-case-result'),
    );
  });

  it('ignores a slow response for an older query', async () => {
    const oldResponse = deferred<PaginatedResult<Stream>>();
    listStreamsMock.mockImplementation((filters?: ListStreamsFilters) => {
      if (filters?.q === 'older') return oldResponse.promise;
      if (filters?.q === 'newer')
        return Promise.resolve(result(['newer-result']));
      return Promise.resolve(result([]));
    });

    renderDashboard();
    const input = await screen.findByLabelText(/Search ID \/ Address/i);

    fireEvent.change(input, { target: { value: 'older', name: 'q' } });
    await waitFor(() =>
      expect(listStreamsMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'older', limit: 20 }),
      ),
    );

    fireEvent.change(input, { target: { value: 'newer', name: 'q' } });
    await screen.findByText('newer-result');

    oldResponse.resolve(result(['older-result']));
    await waitFor(() => expect(listStreamsMock).toHaveBeenCalledTimes(4));
    expect(screen.getByText('newer-result')).toBeInTheDocument();
    expect(screen.queryByText('older-result')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Cancel stream newer-result' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel stream older-result' }),
    ).not.toBeInTheDocument();
    expect(cancelStreamMock).not.toHaveBeenCalled();
  });

  it('retains the query and retries a failed search only once', async () => {
    let searchAttempts = 0;
    listStreamsMock.mockImplementation((filters?: ListStreamsFilters) => {
      if (filters?.q === 'safe query' && searchAttempts++ === 0) {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve(result([]));
    });

    renderDashboard();
    const input = await screen.findByLabelText(/Search ID \/ Address/i);
    fireEvent.change(input, { target: { value: 'safe query', name: 'q' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check your connection and retry.',
    );
    expect(input).toHaveValue('safe query');

    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    fireEvent.click(retry);

    await waitFor(() =>
      expect(
        listStreamsMock.mock.calls.filter(
          ([filters]) => filters?.q === 'safe query',
        ),
      ).toHaveLength(2),
    );
    expect(input).toHaveValue('safe query');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces and retries a failed next-page request, then stops at an empty last page', async () => {
    const firstPage = result(
      Array.from({ length: 20 }, (_, index) => `stream-${index + 1}`),
      21,
    );
    let pageAttempts = 0;
    listStreamsMock.mockImplementation((filters?: ListStreamsFilters) => {
      if (filters?.limit === 1) return Promise.resolve(result([], 21, 1, 1));
      if (filters?.page === 2) {
        pageAttempts += 1;
        if (pageAttempts === 1)
          return Promise.reject(new Error('request expired'));
        return Promise.resolve(result([], 20, 2));
      }
      return Promise.resolve(firstPage);
    });

    renderDashboard();
    const loadMore = await screen.findByRole('button', {
      name: 'Load more streams',
    });
    fireEvent.click(loadMore);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Failed loading more streams',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading streams' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'No more streams to load.',
      ),
    );
    expect(
      screen.queryByRole('button', { name: 'Load more streams' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('stream-1')).toBeInTheDocument();
    expect(pageAttempts).toBe(2);
  });
});
