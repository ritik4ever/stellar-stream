import type { Meta, StoryObj } from '@storybook/react';
import { StreamTimeline } from './StreamTimeline';

const meta: Meta<typeof StreamTimeline> = {
  title: 'Components/StreamTimeline',
  component: StreamTimeline,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof StreamTimeline>;

export const NoStream: Story = {
  args: {
    streamId: undefined,
  },
};

export const WithStreamId: Story = {
  args: {
    streamId: 'stream-abc-123',
  },
};
