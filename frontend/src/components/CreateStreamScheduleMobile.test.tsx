import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateStreamForm } from "./CreateStreamForm";

vi.mock("../services/api", () => ({
  fetchAllowedAssets: vi.fn().mockResolvedValue(["USDC", "XLM"]),
  simulateCreateStreamFee: vi.fn().mockResolvedValue(100),
}));

describe("CreateStreamForm schedule and narrow screen usability (SSB-2026-009)", () => {
  it("renders schedule preview for immediate start at current-minute boundary", async () => {
    render(
      <div style={{ width: "320px", overflow: "hidden" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress="GSENDER_TEST" />
      </div>
    );

    const durationInput = screen.getByLabelText(/Duration \(minutes\)/i);
    const startInput = screen.getByLabelText(/Start In \(minutes\)/i);

    fireEvent.change(durationInput, { target: { value: "60" } });
    fireEvent.change(startInput, { target: { value: "0" } });

    const preview = await screen.findByTestId("schedule-preview");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveTextContent("Starts immediately (current minute)");
    expect(preview).toHaveTextContent("UTC");
  });

  it("renders scheduled start timestamp in UTC when offset is provided", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress="GSENDER_TEST" />);

    const durationInput = screen.getByLabelText(/Duration \(minutes\)/i);
    const startInput = screen.getByLabelText(/Start In \(minutes\)/i);

    fireEvent.change(durationInput, { target: { value: "120" } });
    fireEvent.change(startInput, { target: { value: "30" } });

    const preview = await screen.findByTestId("schedule-preview");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveTextContent(/Starts:/i);
    expect(preview).toHaveTextContent(/Ends:/i);
  });

  it("maintains 44px touch target on submit action button on narrow screens", () => {
    render(
      <div style={{ width: "320px" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress="GSENDER_TEST" />
      </div>
    );

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toHaveStyle({ minHeight: "44px" });
  });
});
