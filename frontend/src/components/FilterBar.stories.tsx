import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { ListStreamsFilters } from '../services/api';

const meta: Meta<typeof FilterBar> = {
  title: 'Components/FilterBar',
  component: FilterBar,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof FilterBar>;

const defaultFilters: ListStreamsFilters = {
  status: '',
  sender: '',
  recipient: '',
  page: 1,
};

export const Default: Story = {
  render: () => {
    const [filters, setFilters] = useState<ListStreamsFilters>(defaultFilters);
    return <FilterBar filters={filters} onChange={setFilters} />;
  },
};

export const WithStatusFilter: Story = {
  render: () => {
    const [filters, setFilters] = useState<ListStreamsFilters>({ ...defaultFilters, status: 'active' });
    return <FilterBar filters={filters} onChange={setFilters} />;
  },
};

export const WithSenderFilter: Story = {
  render: () => {
    const [filters, setFilters] = useState<ListStreamsFilters>({
      ...defaultFilters,
      sender: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    });
    return <FilterBar filters={filters} onChange={setFilters} />;
  },
};
