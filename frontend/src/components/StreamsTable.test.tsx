import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamsTable } from './StreamsTable';
import { Stream } from '../types/stream';
import * as api from '../services/api';

const createMockStream = (
  id: string,
  status: 'active' | 'paused' | 'scheduled' | 'completed' | 'canceled'
): Stream => ({
  id,
  sender: 'SENDER_ADDRESS',
  recipient: 'RECIPIENT_ADDRESS',
  assetCode: 'USDC',
  totalAmount: 1000,
  durationSeconds: 3600,
  startAt: 1670000000,
  createdAt: 1670000000,
  progress: {
    status,
    ratePerSecond: 0.27,
    elapsedSeconds: 1000,
    vestedAmount: 270,
    remainingAmount: 730,
    percentComplete: 27,
  },
});

describe('StreamsTable', () => {
  const mockOnCancel = vi.fn();
  const mockOnEditStartTime = vi.fn();
  const mockOnFiltersChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });


  it('renders an empty state nicely', () => {
    render(
      <StreamsTable
        streams={[]}
        filters={{ status: 'active', sender: '', recipient: '' }}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
      />
    );
    expect(screen.getByText('No streams match your filters.')).toBeInTheDocument();
  });

  it('renders checkboxes only for active, paused, and scheduled streams', () => {
    const streams = [
      createMockStream('1', 'active'),
      createMockStream('2', 'paused'),
      createMockStream('3', 'scheduled'),
      createMockStream('4', 'completed'),
      createMockStream('5', 'canceled'),
    ];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
      />
    );

    // Should have 3 row checkboxes (active + paused + scheduled) + 1 header checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(4);
  });

  it('selects individual streams when checkbox is clicked', () => {
    const streams = [
      createMockStream('1', 'active'),
      createMockStream('2', 'active'),
    ];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    const firstStreamCheckbox = checkboxes[1]; // Skip header checkbox

    fireEvent.click(firstStreamCheckbox);
    expect(firstStreamCheckbox).toBeChecked();

    // Bulk action bar should appear
    expect(screen.getByText(/1 stream selected/i)).toBeInTheDocument();
  });

  it('Select All checkbox selects only eligible streams (active, paused, scheduled)', () => {
    const streams = [
      createMockStream('1', 'active'),
      createMockStream('2', 'paused'),
      createMockStream('3', 'scheduled'),
      createMockStream('4', 'completed'),
      createMockStream('5', 'canceled'),
    ];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
      />
    );

    const selectAllCheckbox = screen.getByLabelText(/select all streams/i);
    fireEvent.click(selectAllCheckbox);

    // Should show 3 streams selected (active + paused + scheduled only)
    expect(screen.getByText(/3 streams selected/i)).toBeInTheDocument();

    // Deselect all
    fireEvent.click(selectAllCheckbox);
    expect(screen.queryByText(/streams selected/i)).not.toBeInTheDocument();
  });

  it('does not show Select All checkbox when no selectable streams exist', () => {
    const streams = [
      createMockStream('1', 'completed'),
      createMockStream('2', 'canceled'),
    ];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
      />
    );

    const checkboxes = screen.queryAllByRole('checkbox');
    expect(checkboxes).toHaveLength(0);
  });
});

describe('StreamsTable - Bulk Cancellation', () => {
  const mockOnCancel = vi.fn();
  const mockOnEditStartTime = vi.fn();
  const mockOnFiltersChange = vi.fn();
  const mockOnRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows bulk action bar when streams are selected', () => {
    const streams = [createMockStream('1', 'active')];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
      />
    );

    const checkbox = screen.getAllByRole('checkbox')[1];
    fireEvent.click(checkbox);

    expect(screen.getByText(/1 stream selected/i)).toBeInTheDocument();
    expect(screen.getByText(/Cancel 1 Stream/i)).toBeInTheDocument();
  });

  it('calls cancelStream sequentially for each selected stream', async () => {
    mockOnCancel.mockResolvedValue(undefined);

    const streams = [
      createMockStream('1', 'active'),
      createMockStream('2', 'active'),
      createMockStream('3', 'active'),
    ];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
        onRefresh={mockOnRefresh}
      />
    );

    // Select all streams
    const selectAllCheckbox = screen.getByLabelText(/select all streams/i);
    fireEvent.click(selectAllCheckbox);

    // Click bulk cancel button
    const cancelButton = screen.getByText(/Cancel 3 Streams/i);
    fireEvent.click(cancelButton);

    // Wait for all cancellations to complete
    await waitFor(() => {
      expect(mockOnCancel).toHaveBeenCalledTimes(3);
    });

    // Verify sequential calls
    expect(mockOnCancel).toHaveBeenNthCalledWith(1, '1');
    expect(mockOnCancel).toHaveBeenNthCalledWith(2, '2');
    expect(mockOnCancel).toHaveBeenNthCalledWith(3, '3');

    // Verify refresh was called
    expect(mockOnRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows progress during bulk cancellation', async () => {
    let resolveFirst: () => void;
    let resolveSecond: () => void;

    mockOnCancel
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = () => resolve();
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = () => resolve();
          })
      );

    const streams = [
      createMockStream('1', 'active'),
      createMockStream('2', 'active'),
    ];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
        onRefresh={mockOnRefresh}
      />
    );

    const selectAllCheckbox = screen.getByLabelText(/select all streams/i);
    fireEvent.click(selectAllCheckbox);

    const cancelButton = screen.getByText(/Cancel 2 Streams/i);
    fireEvent.click(cancelButton);

    // Should show progress
    await waitFor(() => {
      expect(screen.getByText(/Canceling 1\/2/i)).toBeInTheDocument();
    });

    resolveFirst!();

    await waitFor(() => {
      expect(screen.getByText(/Canceling 2\/2/i)).toBeInTheDocument();
    });

    resolveSecond!();

    // Bulk action bar should disappear after completion
    await waitFor(() => {
      expect(screen.queryByText(/streams selected/i)).not.toBeInTheDocument();
    });
  });

  it('continues cancellation even if some streams fail', async () => {
    mockOnCancel
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(undefined);

    const streams = [
      createMockStream('1', 'active'),
      createMockStream('2', 'active'),
      createMockStream('3', 'active'),
    ];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
        onRefresh={mockOnRefresh}
      />
    );

    const selectAllCheckbox = screen.getByLabelText(/select all streams/i);
    fireEvent.click(selectAllCheckbox);

    const cancelButton = screen.getByText(/Cancel 3 Streams/i);
    fireEvent.click(cancelButton);

    // Should still call all three
    await waitFor(() => {
      expect(mockOnCancel).toHaveBeenCalledTimes(3);
    });

    // Should still refresh
    expect(mockOnRefresh).toHaveBeenCalledTimes(1);
  });

  it('clears selection after bulk cancellation completes', async () => {
    mockOnCancel.mockResolvedValue(undefined);

    const streams = [createMockStream('1', 'active')];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
        onRefresh={mockOnRefresh}
      />
    );

    const checkbox = screen.getAllByRole('checkbox')[1];
    fireEvent.click(checkbox);

    const cancelButton = screen.getByText(/Cancel 1 Stream/i);
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByText(/stream selected/i)).not.toBeInTheDocument();
    });
  });

  it('disables cancel button during bulk cancellation', async () => {
    let resolve: () => void;
    mockOnCancel.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolve = () => res();
        })
    );

    const streams = [createMockStream('1', 'active')];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onCancel={mockOnCancel}
        onEditStartTime={mockOnEditStartTime}
      />
    );

    const checkbox = screen.getAllByRole('checkbox')[1];
    fireEvent.click(checkbox);

    const cancelButton = screen.getByText(/Cancel 1 Stream/i) as HTMLButtonElement;
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(cancelButton.disabled).toBe(true);
    });

    resolve!();

    await waitFor(() => {
      expect(screen.queryByText(/stream selected/i)).not.toBeInTheDocument();
    });
  });
});
