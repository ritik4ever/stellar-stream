import type { Meta, StoryObj } from "@storybook/react";
import { VestingBar } from "./VestingBar";

const meta: Meta<typeof VestingBar> = {
  title: "Components/VestingBar",
  component: VestingBar,
};

export default meta;
type Story = StoryObj<typeof VestingBar>;

const now = Math.floor(Date.now() / 1000);

export const NotStarted: Story = {
  args: {
    totalAmount: 10000,
    vestedAmount: 0,
    assetCode: "XLM",
    startTime: now + 86400, // starts tomorrow
    endTime: now + 86400 * 365,
  },
};

export const InProgress: Story = {
  args: {
    totalAmount: 10000,
    vestedAmount: 4200,
    assetCode: "XLM",
    startTime: now - 86400 * 90,
    endTime: now + 86400 * 180,
  },
};

export const FullyVested: Story = {
  args: {
    totalAmount: 10000,
    vestedAmount: 10000,
    assetCode: "XLM",
    startTime: now - 86400 * 365,
    endTime: now - 1,
  },
};