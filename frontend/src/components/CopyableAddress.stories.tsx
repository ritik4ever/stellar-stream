import type { Meta, StoryObj } from '@storybook/react';
import { CopyableAddress } from './CopyableAddress';

const meta: Meta<typeof CopyableAddress> = {
  title: 'Components/CopyableAddress',
  component: CopyableAddress,
  tags: ['autodocs'],
  argTypes: {
    truncationMode: { control: 'radio', options: ['middle', 'end'] },
  },
};
export default meta;
type Story = StoryObj<typeof CopyableAddress>;

export const Default: Story = {
  args: {
    address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    truncationMode: 'middle',
  },
};

export const EndTruncation: Story = {
  args: {
    address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    truncationMode: 'end',
  },
};

export const ShortAddress: Story = {
  args: {
    address: 'GABC1234',
    truncationMode: 'middle',
  },
};
