import type { Meta, StoryObj } from '@storybook/react';
import { useRef } from 'react';
import { StreamsTable } from './StreamsTable';
import { Stream } from '../types/stream';

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

const mockStream: Stream = {
  id: 'stream-001',
  sender: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  recipient: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGUE2DSNHKX4OEUZMPGQK24',
  amount: '1000.0000000',
  token: 'XLM',
  startTime: Math.floor(Date.now() / 1000) - 3600,
  endTime: Math.floor(Date.now() / 1000) + 3600,
  cliffTime: null,
  status: 'active',
  canceledAt: null,
  createdAt: new Date().toISOString(),
  withdrawnAmount: '250.0000000',
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
      { ...mockStream, id: 'stream-002', status: 'paused' },
      { ...mockStream, id: 'stream-003', status: 'completed' },
      { ...mockStream, id: 'stream-004', status: 'canceled', canceledAt: new Date().toISOString() },
    ],
    loading: false,
    filters: defaultFilters,
    onFiltersChange: () => {},
    onCancel: async (id) => console.log('Cancel', id),
    onPause: async (id) => console.log('Pause', id),
    onResume: async (id) => console.log('Resume', id),
    onOpenStream: (id) => console.log('Open', id),
    onEditStartTime: () => {},
    totalStreamCount: 4,
  },
};
