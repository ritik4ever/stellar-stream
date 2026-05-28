import type { Meta, StoryObj } from "@storybook/react";
import { WalletButton } from "./WalletButton";

const meta: Meta<typeof WalletButton> = {
  title: "Components/WalletButton",
  component: WalletButton,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof WalletButton>;

export const Connected: Story = {
  args: {
    wallet: {
      address: "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6",
      isConnected: true,
    },
  },
};

export const Disconnected: Story = {
  args: {
    wallet: {
      address: null,
      isConnected: false,
    },
  },
};
