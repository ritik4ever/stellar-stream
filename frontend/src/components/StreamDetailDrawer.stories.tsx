import type { Meta, StoryObj } from '@storybook/react';
import { StreamDetailDrawer } from './StreamDetailDrawer';

const meta: Meta<typeof StreamDetailDrawer> = {
  title: 'Components/StreamDetailDrawer',
  component: StreamDetailDrawer,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;
type Story = StoryObj<typeof StreamDetailDrawer>;

export const Open: Story = {
  args: {
    streamId: 'stream-abc-123',
    onClose: () => alert('Drawer closed'),
  },
};

export const Closed: Story = {
  args: {
    streamId: '',
    onClose: () => {},
  },
};
