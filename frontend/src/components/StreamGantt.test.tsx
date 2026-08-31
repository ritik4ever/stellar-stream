import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import {
  StreamGantt,
  streamGanttColor,
  GANTT_COLORS,
  ZOOM_LEVELS,
} from './StreamGantt';
import { Stream } from '../types/stream';

const DAY = 24 * 60 * 60;

function makeStream(
  id: string,
  status: Stream['progress']['status'] = 'active',
  overrides: Partial<Stream> = {},
): Stream {
  return {
    id,
    sender: 'G_SENDER123456789012345678901234567890123456789012345678901',
    recipient: 'G_RECIPIENT123456789012345678901234567890123456789012345',
    assetCode: 'USDC',
    totalAmount: 1000,
    durationSeconds: 30 * DAY,
    startAt: 1_750_000_000,
    createdAt: 1_750_000_000,
    progress: {
      status,
      ratePerSecond: 0.001,
      elapsedSeconds: 0,
      vestedAmount: 0,
      remainingAmount: 1000,
      percentComplete: 0,
    },
    ...overrides,
  };
}

describe('StreamGantt', () => {
  it('renders one row per stream', () => {
    render(
      <StreamGantt
        streams={[
          makeStream('stream-001'),
          makeStream('stream-002', 'completed'),
        ]}
      />,
    );
    expect(screen.getByLabelText('Open stream stream-001')).toBeInTheDocument();
    expect(screen.getByLabelText('Open stream stream-002')).toBeInTheDocument();
  });

  it('renders an empty state when there are no streams', () => {
    render(<StreamGantt streams={[]} />);
    expect(screen.getByText(/No streams to display yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Open stream ')).not.toBeInTheDocument();
  });

  it('color-codes bars by vesting status', () => {
    render(
      <StreamGantt
        streams={[
          makeStream('sched', 'scheduled'),
          makeStream('act', 'active'),
          makeStream('done', 'completed'),
        ]}
      />,
    );

    expect(screen.getByLabelText('Open stream sched')).toHaveStyle({
      background: GANTT_COLORS.unvested,
    });
    expect(screen.getByLabelText('Open stream act')).toHaveStyle({
      background: GANTT_COLORS.vested,
    });
    expect(screen.getByLabelText('Open stream done')).toHaveStyle({
      background: GANTT_COLORS.claimed,
    });
  });

  it('maps statuses to the documented color semantics', () => {
    expect(streamGanttColor('scheduled')).toBe(GANTT_COLORS.unvested);
    expect(streamGanttColor('canceled')).toBe(GANTT_COLORS.unvested);
    expect(streamGanttColor('active')).toBe(GANTT_COLORS.vested);
    expect(streamGanttColor('paused')).toBe(GANTT_COLORS.vested);
    expect(streamGanttColor('completed')).toBe(GANTT_COLORS.claimed);
  });

  it('defaults to week zoom', () => {
    render(<StreamGantt streams={[makeStream('stream-001')]} />);
    expect(screen.getByTestId('stream-gantt')).toHaveAttribute(
      'data-zoom',
      'week',
    );
    expect(screen.getByRole('button', { name: /week zoom/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switches zoom level when a zoom button is clicked', () => {
    render(<StreamGantt streams={[makeStream('stream-001')]} />);
    const container = screen.getByTestId('stream-gantt');

    fireEvent.click(screen.getByRole('button', { name: /day zoom/i }));
    expect(container).toHaveAttribute('data-zoom', 'day');

    fireEvent.click(screen.getByRole('button', { name: /month zoom/i }));
    expect(container).toHaveAttribute('data-zoom', 'month');
  });

  it('exposes the expected zoom levels', () => {
    expect(ZOOM_LEVELS.map((level) => level.key)).toEqual([
      'day',
      'week',
      'month',
    ]);
  });

  it('calls onOpenStream with the stream id when a bar is clicked', () => {
    const onOpenStream = vi.fn();
    render(
      <StreamGantt
        streams={[makeStream('stream-001')]}
        onOpenStream={onOpenStream}
      />,
    );
    fireEvent.click(screen.getByLabelText('Open stream stream-001'));
    expect(onOpenStream).toHaveBeenCalledWith('stream-001');
  });

  it('renders up to 50 streams without issues', () => {
    const streams = Array.from({ length: 50 }, (_, index) =>
      makeStream(`stream-${String(index).padStart(3, '0')}`, 'active'),
    );
    render(<StreamGantt streams={streams} />);
    expect(screen.getByLabelText('Open stream stream-000')).toBeInTheDocument();
    expect(screen.getByLabelText('Open stream stream-049')).toBeInTheDocument();
  });

  it('shows a vested progress fill for active streams', () => {
    const stream = makeStream('act', 'active', {
      progress: {
        status: 'active',
        ratePerSecond: 0.001,
        elapsedSeconds: 100,
        vestedAmount: 500,
        remainingAmount: 500,
        percentComplete: 50,
      },
    });
    render(<StreamGantt streams={[stream]} />);
    const vested = screen.getAllByTestId('stream-gantt-vested');
    expect(vested).toHaveLength(1);
    expect(vested[0]).toHaveStyle({ width: '50%' });
  });

  it('shows the stream count summary', () => {
    render(
      <StreamGantt
        streams={[makeStream('a', 'active'), makeStream('b', 'active')]}
      />,
    );
    expect(screen.getByText(/Showing 2 streams/i)).toBeInTheDocument();
  });
});
