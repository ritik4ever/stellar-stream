import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StreamsTable } from './StreamsTable'; 
import { Stream } from '../types/stream'; 

const mockStreams: Stream[] = [
  {
    id: '1',
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT123',
    assetCode: 'USDC',
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1670000000,
    createdAt: 1670000000,
    progress: {
      status: 'active',
      ratePerSecond: 0.01,
      elapsedSeconds: 100,
      vestedAmount: 20,
      remainingAmount: 80,
      percentComplete: 20,
    },
  },
  {
    id: '2',
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT123',
    assetCode: 'USDC',
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1770000000,
    createdAt: 1670000000,
    progress: {
      status: 'scheduled',
      ratePerSecond: 0.01,
      elapsedSeconds: 0,
      vestedAmount: 0,
      remainingAmount: 100,
      percentComplete: 0,
    },
  },
  {
    id: '3',
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT123',
    assetCode: 'USDC',
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1670000000,
    createdAt: 1670000000,
    progress: {
      status: 'completed',
      ratePerSecond: 0.01,
      elapsedSeconds: 3600,
      vestedAmount: 100,
      remainingAmount: 0,
      percentComplete: 100,
    },
  },
  {
    id: '4',
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT123',
    assetCode: 'USDC',
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1670000000,
    createdAt: 1670000000,
    progress: {
      status: 'canceled',
      ratePerSecond: 0.01,
      elapsedSeconds: 500,
      vestedAmount: 10,
      remainingAmount: 90,
      percentComplete: 10,
    },
  },
];

const defaultProps = {
  streams: mockStreams,
  filters: {},
  onFiltersChange: vi.fn(),
  onCancel: vi.fn().mockResolvedValue(undefined),
  onEditStartTime: vi.fn(),
};

describe('StreamsTable Component', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders table data when streams are passed', () => {
    render(
      <StreamsTable 
        {...defaultProps}
      />
    );
    
    // Checking for text elements populated by the array map
    expect(screen.getAllByTitle('G_RECIPIENT123').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0);
  });

  it('renders correct status badges for all statuses', () => {
    render(<StreamsTable {...defaultProps} />);
    
    expect(screen.getByText('active')).toHaveClass('badge-active');
    expect(screen.getByText('scheduled')).toHaveClass('badge-scheduled');
    expect(screen.getByText('completed')).toHaveClass('badge-completed');
    expect(screen.getByText('canceled')).toHaveClass('badge-canceled');
  });

  it('calls onCancel when cancel button is clicked on an active stream', () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(<StreamsTable {...defaultProps} onCancel={onCancel} />);
    
    const cancelButtons = screen.getAllByLabelText(/cancel stream/i);
    // Stream 1 is active, cancel should be enabled
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalledWith('1');
  });

  it('disables cancel button for completed or canceled streams', () => {
    render(<StreamsTable {...defaultProps} />);
    
    const cancelButtons = screen.getAllByLabelText(/cancel stream/i);
    // Stream 3 is completed (index 2), Stream 4 is canceled (index 3)
    expect(cancelButtons[2]).toBeDisabled();
    expect(cancelButtons[3]).toBeDisabled();
  });

  it('renders a helpful message for empty streams array', () => {
    render(<StreamsTable {...defaultProps} streams={[]} />);
    
    expect(screen.getByText(/no streams yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders EmptyState for filtered empty results and clears filters', () => {
    const onFiltersChange = vi.fn();
    render(
      <StreamsTable
        {...defaultProps}
        streams={[]}
        filters={{ status: 'active' }}
        onFiltersChange={onFiltersChange}
        totalStreamCount={4}
      />
    );

    expect(screen.getByText(/no active streams/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(onFiltersChange).toHaveBeenCalledWith({
      status: '',
      sender: '',
      recipient: '',
      asset: '',
      q: '',
    });
  });

  it('shows Create Stream button when there are no streams at all', () => {
    const onCreateStream = vi.fn();
    render(
      <StreamsTable
        {...defaultProps}
        streams={[]}
        onCreateStream={onCreateStream}
      />
    );

    const createButton = screen.getByRole('button', { name: /create stream/i });
    expect(createButton).toBeInTheDocument();
    fireEvent.click(createButton);
    expect(onCreateStream).toHaveBeenCalled();
  });
});