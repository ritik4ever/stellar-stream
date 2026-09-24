import type { Meta, StoryObj } from "@storybook/react";
import { VestingClock } from "./VestingClock";

const meta: Meta<typeof VestingClock> = {
  title: "Components/VestingClock",
  component: VestingClock,
};

export default meta;
type Story = StoryObj<typeof VestingClock>;

const now = Math.floor(Date.now() / 1000);

export const CountingDown: Story = {
  args: {
    endTime: now + 86400 * 45 + 3600 * 6, // ~45 days, 6 hours left
  },
};

export const EndingSoon: Story = {
  args: {
    endTime: now + 60 * 20, // 20 minutes left
  },
};

export const Complete: Story = {
  args: {
    endTime: now - 3600, // ended an hour ago
  },
};