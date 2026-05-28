import type { Meta, StoryObj } from "@storybook/react";
import { OfflineBanner } from "./OfflineBanner";

const meta: Meta<typeof OfflineBanner> = {
  title: "Components/OfflineBanner",
  component: OfflineBanner,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof OfflineBanner>;

export const Default: Story = {};
