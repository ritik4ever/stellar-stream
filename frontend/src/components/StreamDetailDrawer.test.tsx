import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../server';
import { StreamDetailDrawer } from './StreamDetailDrawer';

const onClose = vi.fn();
const onCancel = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  onClose.mockClear();
  onCancel.mockClear();
});

describe('StreamDetailDrawer', () => {
  it('shows skeleton while loading', () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    // aria-busy skeleton container should be present immediately
    expect(screen.getByLabelText('Loading stream details')).toBeInTheDocument();
  });

  it('renders stream metadata after load', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Stream Detail')).toBeInTheDocument());
    // Metadata
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    // Asset row in metadata dl
    expect(screen.getAllByText(/1000.*USDC/).length).toBeGreaterThan(0);
  });

  it('renders progress section', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument());
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('renders event history', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Stream created')).toBeInTheDocument());
    expect(screen.getByText('Tokens claimed')).toBeInTheDocument();
  });

  it('shows empty history placeholder when no events', async () => {
    server.use(
      http.get('/api/streams/:id/history', () =>
        HttpResponse.json({ data: [] })
      )
    );
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('No events yet.')).toBeInTheDocument());
  });

  it('shows error state for missing stream', async () => {
    render(<StreamDetailDrawer streamId="missing" onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
    expect(screen.getByText(/could not be found/i)).toBeInTheDocument();
  });

  it('shows retry button on error', async () => {
    render(<StreamDetailDrawer streamId="missing" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument());
  });

  it('calls onClose when close button is clicked', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByLabelText('Close stream detail')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Close stream detail'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders cancel button when onCancel is provided', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText('Cancel Stream')).toBeInTheDocument());
  });

  it('cancel button is disabled for finalized streams', async () => {
    server.use(
      http.get('/api/streams/:id', () =>
        HttpResponse.json({
          data: {
            id: '42',
            sender: 'GSENDER',
            recipient: 'GRECIPIENT',
            assetCode: 'USDC',
            totalAmount: 1000,
            durationSeconds: 86400,
            startAt: 1700000000,
            createdAt: 1699990000,
            canceledAt: 1700050000,
            progress: {
              status: 'canceled',
              ratePerSecond: 0,
              elapsedSeconds: 0,
              vestedAmount: 0,
              remainingAmount: 0,
              percentComplete: 0,
            },
          },
        })
      )
    );
    render(<StreamDetailDrawer streamId="42" onClose={onClose} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText('Cancel Stream')).toBeDisabled());
  });

  it('does not render cancel button when onCancel is not provided', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.queryByText('Cancel Stream')).not.toBeInTheDocument());
  });
});
