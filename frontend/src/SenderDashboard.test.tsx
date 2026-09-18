import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SenderDashboard } from "./SenderDashboard";

vi.mock("./services/api", () => ({
  fetchStreams: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  fetchMetrics: vi.fn().mockResolvedValue({ totalStreams: 0, totalAmount: "0" }),
}));

describe("SenderDashboard", () => {
  it("should render stream list", async () => {
    render(<SenderDashboard />);
    expect(screen.getByText(/streams/i)).toBeTruthy();
  });

  it("should display metrics", async () => {
    render(<SenderDashboard />);
    expect(await screen.findByText(/0/)).toBeTruthy();
  });
});
