import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../server';
import {
  getFarcasterShareUrl,
  getPublicStreamUrl,
  getTwitterShareUrl,
  StreamDetailDrawer,
} from './StreamDetailDrawer';
import { Stream } from '../types/stream';
import { clearCache } from '../services/api';

// ---------------------------------------------------------------------------
// Shared mock handlers
// ---------------------------------------------------------------------------

const onClose = vi.fn();
const onCancel = vi.fn().mockResolvedValue(undefined);
const onPause = vi.fn().mockResolvedValue(undefined);
const onResume = vi.fn().mockResolvedValue(undefined);
const signAction = vi.fn().mockResolvedValue('mock-signature');

/** Returns an MSW override that serves a stream with the given status */
function streamWithStatus(status: string, sender = 'GSENDER123') {
  return http.get('/api/streams/:id', () =>
    HttpResponse.json({
      data: {
        id: '42',
        sender,
        recipient: 'GRECIPIENT456',
        assetCode: 'USDC',
        totalAmount: 1000,
        durationSeconds: 86400,
        startAt: 1700000000,
        createdAt: 1699990000,
        progress: {
          status,
          ratePerSecond: 0.01157,
          elapsedSeconds: 43200,
          vestedAmount: 500,
          remainingAmount: 500,
          percentComplete: 50,
        },
      },
    }),
  );
}

beforeEach(() => {
  onClose.mockClear();
  onCancel.mockClear();
  onPause.mockClear();
  onResume.mockClear();
  signAction.mockClear();
  clearCache();
});

// ---------------------------------------------------------------------------
// Original drawer tests (kept passing)
// ---------------------------------------------------------------------------

describe('StreamDetailDrawer', () => {
  it('shows skeleton while loading', () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    expect(screen.getByLabelText('Loading stream details')).toBeInTheDocument();
  });

  it('renders stream metadata after load', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Stream Detail')).toBeInTheDocument());
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
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
      http.get('/api/streams/:id/history', () => HttpResponse.json({ data: [] })),
    );
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('No events yet.')).toBeInTheDocument());
  });

  it('shows error state for missing stream', async () => {
    render(<StreamDetailDrawer streamId="missing" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
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
    server.use(streamWithStatus('canceled'));
    render(<StreamDetailDrawer streamId="42" onClose={onClose} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText('Cancel Stream')).toBeDisabled());
  });

  it('does not render cancel button when onCancel is not provided', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.queryByText('Cancel Stream')).not.toBeInTheDocument());
  });

  // ── Pause button visibility ───────────────────────────────────────────────

  describe('Pause button', () => {
    it('visible for active stream when wallet matches sender', async () => {
      // Default MSW stream is active, sender = GSENDER123
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.getByText('⏸ Pause')).toBeInTheDocument());
    });

    it('not visible when wallet does not match sender', async () => {
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          signAction={signAction}
          walletAddress="GDIFFERENT"
        />,
      );
      await waitFor(() => expect(screen.queryByText('⏸ Pause')).not.toBeInTheDocument());
    });

    it('not visible when wallet is not connected (null)', async () => {
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          signAction={signAction}
          walletAddress={null}
        />,
      );
      await waitFor(() => expect(screen.queryByText('⏸ Pause')).not.toBeInTheDocument());
    });

    it('not visible for paused stream (already paused)', async () => {
      server.use(streamWithStatus('paused'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.queryByText('⏸ Pause')).not.toBeInTheDocument());
    });

    it('not visible for completed stream', async () => {
      server.use(streamWithStatus('completed'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.queryByText('⏸ Pause')).not.toBeInTheDocument());
    });

    it('not visible when onPause prop is absent', async () => {
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.queryByText('⏸ Pause')).not.toBeInTheDocument());
    });

    it('not visible when signAction prop is absent', async () => {
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.queryByText('⏸ Pause')).not.toBeInTheDocument());
    });
  });

  // ── Resume button visibility ──────────────────────────────────────────────

  describe('Resume button', () => {
    it('visible for paused stream when wallet matches sender', async () => {
      server.use(streamWithStatus('paused'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onResume={onResume}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.getByText('▶ Resume')).toBeInTheDocument());
    });

    it('not visible for active stream (not paused)', async () => {
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onResume={onResume}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.queryByText('▶ Resume')).not.toBeInTheDocument());
    });

    it('not visible when wallet does not match sender', async () => {
      server.use(streamWithStatus('paused'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onResume={onResume}
          signAction={signAction}
          walletAddress="GDIFFERENT"
        />,
      );
      await waitFor(() => expect(screen.queryByText('▶ Resume')).not.toBeInTheDocument());
    });

    it('not visible when wallet is not connected', async () => {
      server.use(streamWithStatus('paused'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onResume={onResume}
          signAction={signAction}
          walletAddress={null}
        />,
      );
      await waitFor(() => expect(screen.queryByText('▶ Resume')).not.toBeInTheDocument());
    });
  });

  // ── Pause action flow ─────────────────────────────────────────────────────

  describe('Pause action', () => {
    it('calls signAction with correct payload then calls onPause', async () => {
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.getByText('⏸ Pause')).toBeInTheDocument());

      fireEvent.click(screen.getByText('⏸ Pause'));

      await waitFor(() => expect(signAction).toHaveBeenCalledTimes(1));
      const [payload] = signAction.mock.calls[0];
      expect(payload.action).toBe('pause');
      expect(payload.streamId).toBe('42');
      expect(typeof payload.timestamp).toBe('number');

      await waitFor(() => expect(onPause).toHaveBeenCalledWith('42'));
    });

    it('shows error alert when signAction rejects', async () => {
      signAction.mockRejectedValueOnce(new Error('User rejected signing'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.getByText('⏸ Pause')).toBeInTheDocument());
      fireEvent.click(screen.getByText('⏸ Pause'));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('User rejected signing'),
      );
      expect(onPause).not.toHaveBeenCalled();
    });

    it('shows error alert when onPause rejects', async () => {
      onPause.mockRejectedValueOnce(new Error('API error 503'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onPause={onPause}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.getByText('⏸ Pause')).toBeInTheDocument());
      fireEvent.click(screen.getByText('⏸ Pause'));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('API error 503'),
      );
    });
  });

  // ── Resume action flow ────────────────────────────────────────────────────

  describe('Resume action', () => {
    it('calls signAction with correct payload then calls onResume', async () => {
      server.use(streamWithStatus('paused'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onResume={onResume}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.getByText('▶ Resume')).toBeInTheDocument());

      fireEvent.click(screen.getByText('▶ Resume'));

      await waitFor(() => expect(signAction).toHaveBeenCalledTimes(1));
      const [payload] = signAction.mock.calls[0];
      expect(payload.action).toBe('resume');
      expect(payload.streamId).toBe('42');
      expect(typeof payload.timestamp).toBe('number');

      await waitFor(() => expect(onResume).toHaveBeenCalledWith('42'));
    });

    it('shows error alert when onResume rejects', async () => {
      server.use(streamWithStatus('paused'));
      onResume.mockRejectedValueOnce(new Error('Resume failed'));
      render(
        <StreamDetailDrawer
          streamId="42"
          onClose={onClose}
          onResume={onResume}
          signAction={signAction}
          walletAddress="GSENDER123"
        />,
      );
      await waitFor(() => expect(screen.getByText('▶ Resume')).toBeInTheDocument());
      fireEvent.click(screen.getByText('▶ Resume'));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Resume failed'),
      );
    });
  });
});

// ── Stellar Expert transaction links (#399) ──────────────────────────────────

describe('TxHashLink — Stellar Expert transaction links (#399)', () => {
  beforeEach(() => {
    onClose.mockClear();
    clearCache();
  });

  it('renders txHash as a link to Stellar Expert testnet', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Tokens claimed')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: /View transaction.*Stellar Expert/i });
    expect(link).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/tx/abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    );
  });

  it('link opens in a new tab with rel=noopener noreferrer', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Tokens claimed')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: /View transaction/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('displays truncated hash (first 8 + last 8 chars)', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Tokens claimed')).toBeInTheDocument());

    // full: abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab
    expect(screen.getByText('abcdef12\u2026567890ab')).toBeInTheDocument();
  });

  it('full hash is in the tooltip (title attribute)', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Tokens claimed')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: /View transaction/i });
    expect(link).toHaveAttribute(
      'title',
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    );
  });

  it('does not render a tx link when txHash is absent', async () => {
    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Stream created')).toBeInTheDocument());
    // "created" event has no txHash — only the "claimed" event has a link
    const links = screen.queryAllByRole('link', { name: /View transaction/i });
    expect(links.length).toBeLessThanOrEqual(1);
  });
});

describe('Stream sharing', () => {
  const stream = {
    id: '42/featured',
    sender: 'GSENDER123',
    recipient: 'GRECIPIENT456',
    assetCode: 'USDC',
    totalAmount: 1000,
    durationSeconds: 86400,
    startAt: 1700000000,
    createdAt: 1699990000,
    progress: {
      status: 'active' as const,
      ratePerSecond: 0.01157,
      elapsedSeconds: 43200,
      vestedAmount: 500,
      remainingAmount: 500,
      percentComplete: 50,
    },
  } satisfies Stream;

  it('builds encoded public, Twitter, and Farcaster URLs', () => {
    const publicUrl = getPublicStreamUrl(stream.id);
    expect(publicUrl).toBe(`${window.location.origin}/stream/42%2Ffeatured`);

    const twitterUrl = new URL(getTwitterShareUrl(stream));
    expect(twitterUrl.origin).toBe('https://twitter.com');
    expect(twitterUrl.pathname).toBe('/intent/tweet');
    expect(twitterUrl.searchParams.get('url')).toBe(publicUrl);
    expect(twitterUrl.searchParams.get('text')).toContain('1000 USDC');

    const farcasterUrl = new URL(getFarcasterShareUrl(stream));
    expect(farcasterUrl.origin).toBe('https://warpcast.com');
    expect(farcasterUrl.pathname).toBe('/~/compose');
    expect(farcasterUrl.searchParams.get('embeds[]')).toBe(publicUrl);
  });

  it('renders share links and gives copy success feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<StreamDetailDrawer streamId="42" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Share on Twitter' })).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'Share on Farcaster' })).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/stream/42`);
  });
});
