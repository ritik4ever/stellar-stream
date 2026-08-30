import type { Meta, StoryObj } from '@storybook/react';
import { StreamsTable } from './StreamsTable';
import { Stream, StreamProgress } from '../types/stream';

const meta: Meta<typeof StreamsTable> = {
  title: 'Components/StreamsTable',
  component: StreamsTable,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;
type Story = StoryObj<typeof StreamsTable>;

function makeProgress(overrides: Partial<StreamProgress> = {}): StreamProgress {
  return {
    status: 'active',
    ratePerSecond: 0.5,
    elapsedSeconds: 1800,
    vestedAmount: 400,
    remainingAmount: 600,
    percentComplete: 40,
    ...overrides,
  };
}

const mockStream: Stream = {
  id: 'stream-001',
  sender: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  recipient: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGUE2DSNHKX4OEUZMPGQK24',
  assetCode: 'XLM',
  totalAmount: 1000,
  durationSeconds: 7200,
  startAt: Math.floor(Date.now() / 1000) - 3600,
  createdAt: Math.floor(Date.now() / 1000) - 7200,
  progress: makeProgress(),
};

const defaultFilters = { status: '', sender: '', recipient: '', page: 1 };

export const Empty: Story = {
  args: {
    streams: [],
    loading: false,
    filters: defaultFilters,
    onFiltersChange: () => {},
    onCancel: async () => {},
    onPause: async () => {},
    onResume: async () => {},
    onEditStartTime: () => {},
  },
};

export const Loading: Story = {
  args: {
    streams: [],
    loading: true,
    filters: defaultFilters,
    onFiltersChange: () => {},
    onCancel: async () => {},
    onPause: async () => {},
    onResume: async () => {},
    onEditStartTime: () => {},
  },
};

export const WithStreams: Story = {
  args: {
    streams: [
      mockStream,
      { ...mockStream, id: 'stream-002', progress: makeProgress({ status: 'paused' }) },
      { ...mockStream, id: 'stream-003', progress: makeProgress({ status: 'completed', percentComplete: 100, remainingAmount: 0, vestedAmount: 1000 }) },
      {
        ...mockStream,
        id: 'stream-004',
        progress: makeProgress({ status: 'canceled', percentComplete: 20 }),
        canceledAt: Math.floor(Date.now() / 1000) - 1800,
      },
    ],
    loading: false,
    filters: defaultFilters,
    onFiltersChange: () => {},
    onCancel: async () => {},
    onPause: async () => {},
    onResume: async () => {},
    onOpenStream: () => {},
    onEditStartTime: () => {},
    totalStreamCount: 4,
  },
};
