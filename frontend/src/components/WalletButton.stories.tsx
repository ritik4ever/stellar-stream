import type { Meta, StoryObj } from '@storybook/react';
import { WalletButton } from './WalletButton';

const meta: Meta<typeof WalletButton> = {
  title: 'Components/WalletButton',
  component: WalletButton,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof WalletButton>;

const baseWallet = {
  installed: true,
  address: null,
  status: 'idle' as const,
  error: null,
  connect: () => Promise.resolve(),
  disconnect: () => {},
};

export const NotInstalled: Story = {
  args: {
    wallet: { ...baseWallet, installed: false, status: 'idle' },
  },
};

export const Idle: Story = {
  args: {
    wallet: baseWallet,
  },
};

export const Connecting: Story = {
  args: {
    wallet: { ...baseWallet, status: 'connecting' },
  },
};

export const Connected: Story = {
  args: {
    wallet: {
      ...baseWallet,
      status: 'connected',
      address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    },
  },
};

export const WithError: Story = {
  args: {
    wallet: { ...baseWallet, status: 'idle', error: 'Failed to connect. Please try again.' },
  },
};
