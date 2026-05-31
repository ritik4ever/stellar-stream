import type { Meta, StoryObj } from "@storybook/react";
import { FilterBar } from "./FilterBar";

const meta: Meta<typeof FilterBar> = {
  title: "Components/FilterBar",
  component: FilterBar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FilterBar>;

export const Default: Story = {
  args: {
    filters: {
      status: "active",
      sender: "",
      recipient: "",
      asset: "",
    },
    onFiltersChange: (f) => console.log("Filters changed", f),
  },
};
