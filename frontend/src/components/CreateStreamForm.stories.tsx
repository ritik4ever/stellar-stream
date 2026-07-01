import type { Meta, StoryObj } from '@storybook/react';
import { CreateStreamForm } from './CreateStreamForm';

const meta: Meta<typeof CreateStreamForm> = {
  title: 'Components/CreateStreamForm',
  component: CreateStreamForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};
export default meta;
type Story = StoryObj<typeof CreateStreamForm>;

export const Default: Story = {
  args: {
    onCreate: async (payload) => {
      console.log('Create stream payload:', payload);
    },
    onCreateSplit: async (payload) => {
      console.log('Create split stream payload:', payload);
    },
    apiError: null,
    walletAddress: null,
  },
};

export const WithWalletConnected: Story = {
  args: {
    onCreate: async (payload) => {
      console.log('Create stream payload:', payload);
    },
    onCreateSplit: async (payload) => {
      console.log('Create split stream payload:', payload);
    },
    apiError: null,
    walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
};

export const WithApiError: Story = {
  args: {
    onCreate: async () => { throw new Error('API Error'); },
    apiError: 'Failed to create stream. Please try again.',
    walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
};
