import type { Meta, StoryObj } from "@storybook/react";
import { CopyableAddress } from "./CopyableAddress";

const meta: Meta<typeof CopyableAddress> = {
  title: "Components/CopyableAddress",
  component: CopyableAddress,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof CopyableAddress>;

export const Default: Story = {
  args: {
    address: "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6",
  },
};

export const Short: Story = {
  args: {
    address: "GBX5...U4E6",
  },
};
