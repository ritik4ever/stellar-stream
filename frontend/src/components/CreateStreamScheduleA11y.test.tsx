import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateCreateStreamFee, getConfig } from "../services/api";
import { CreateStreamForm } from "./CreateStreamForm";

const SENDER = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
const RECIPIENT = "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E";

vi.mock("../services/api", () => ({
  estimateCreateStreamFee: vi.fn(),
  getConfig: vi.fn(),
}));

describe("CreateStreamForm schedule keyboard and screen reader accessibility (SSB-2026-008)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockResolvedValue({ allowedAssets: ["USDC", "XLM"] });
    vi.mocked(estimateCreateStreamFee).mockResolvedValue({
      feeStroops: 100,
      feeXlm: "0.00001",
    });
  });

  it("supports keyboard-only focus navigation through duration and start offset fields", async () => {
    const user = userEvent.setup();
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const durationInput = screen.getByLabelText(/Duration \(minutes\)/i);
    const startInput = screen.getByLabelText(/Start In \(minutes\)/i);

    durationInput.focus();
    expect(durationInput).toHaveFocus();

    await user.tab();
    expect(startInput).toHaveFocus();
  });

  it("announces previewed schedule start and end timestamps via polite live region", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const durationInput = screen.getByLabelText(/Duration \(minutes\)/i);
    fireEvent.change(durationInput, { target: { value: "120" } });

    const preview = screen.getByTestId("schedule-preview");
    expect(preview).toHaveAttribute("role", "status");
    expect(preview).toHaveAttribute("aria-live", "polite");
    expect(preview).toHaveTextContent("UTC");
  });

  it("associates role=alert and aria-invalid on invalid duration", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const durationInput = screen.getByLabelText(/Duration \(minutes\)/i);
    fireEvent.change(durationInput, { target: { value: "0" } });
    fireEvent.blur(durationInput);

    expect(durationInput).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Duration must be at least 1 minute/i);
  });

  it("renders accessible duration in review modal with aria-labelledby", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fireEvent.change(screen.getByLabelText(/Sender Account/i), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(screen.getByLabelText(/Total Amount/i), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText(/Duration \(minutes\)/i), {
      target: { value: "60" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    const durationLabel = await screen.findByText("60 minutes");
    expect(durationLabel).toHaveAttribute("aria-labelledby", "review-duration-dt");
  });
});
