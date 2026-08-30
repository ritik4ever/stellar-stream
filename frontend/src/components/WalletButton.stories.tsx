import type { Meta, StoryObj } from '@storybook/react';
import { WalletButton } from './WalletButton';
import type { FreighterState } from '../hooks/useFreighter';

const meta: Meta<typeof WalletButton> = {
  title: 'Components/WalletButton',
  component: WalletButton,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof WalletButton>;

const noop = () => {};
const noopAsync = () => Promise.resolve();
const noopSign = async () => '';

export const NotInstalled: Story = {
  args: {
    wallet: {
      installed: false,
      allowed: false,
      address: null,
      status: 'idle',
      error: null,
      connect: noopAsync,
      disconnect: noop,
      signAction: noopSign,
    } satisfies FreighterState,
  },
};

export const Idle: Story = {
  args: {
    wallet: {
      installed: true,
      allowed: false,
      address: null,
      status: 'idle',
      error: null,
      connect: noopAsync,
      disconnect: noop,
      signAction: noopSign,
    } satisfies FreighterState,
  },
};

export const Connecting: Story = {
  args: {
    wallet: {
      installed: true,
      allowed: false,
      address: null,
      status: 'connecting',
      error: null,
      connect: noopAsync,
      disconnect: noop,
      signAction: noopSign,
    } satisfies FreighterState,
  },
};

export const Connected: Story = {
  args: {
    wallet: {
      installed: true,
      allowed: true,
      address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      status: 'connected',
      error: null,
      connect: noopAsync,
      disconnect: noop,
      signAction: noopSign,
    } satisfies FreighterState,
  },
};

export const WithError: Story = {
  args: {
    wallet: {
      installed: true,
      allowed: false,
      address: null,
      status: 'idle',
      error: 'Failed to connect. Please try again.',
      connect: noopAsync,
      disconnect: noop,
      signAction: noopSign,
    } satisfies FreighterState,
  },
};
