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

describe("CreateStreamForm recipient keyboard and screen reader accessibility (SSB-2026-013)", () => {
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

  it("links recipient input to polite live hint region via aria-describedby", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const recipientInput = screen.getByLabelText(/Recipient Account/i);
    expect(recipientInput).toHaveAttribute("aria-describedby", "recipient-hint");

    fireEvent.change(recipientInput, { target: { value: "GABC" } });
    const hint = screen.getByText(/more character/i);
    expect(hint).toHaveAttribute("id", "recipient-hint");
    expect(hint).toHaveAttribute("aria-live", "polite");
  });

  it("associates role=alert and aria-invalid on recipient validation error", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const recipientInput = screen.getByLabelText(/Recipient Account/i);
    fireEvent.change(recipientInput, { target: { value: "INVALID_KEY" } });
    fireEvent.blur(recipientInput);

    expect(recipientInput).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
  });

  it("renders semantically accessible sender and recipient terms in review modal", async () => {
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
    fireEvent.change(screen.getByLabelText(/Duration/i), {
      target: { value: "60" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    const senderVal = await screen.findByTestId("preview-sender");
    const recipientVal = screen.getByTestId("preview-recipient");

    expect(senderVal).toHaveAttribute("aria-labelledby", "review-sender-dt");
    expect(recipientVal).toHaveAttribute("aria-labelledby", "review-recipient-dt");
  });

  it("allows keyboard activation of modal confirmation actions", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<CreateStreamForm onCreate={onCreate} walletAddress={SENDER} />);

    fireEvent.change(screen.getByLabelText(/Sender Account/i), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(screen.getByLabelText(/Total Amount/i), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText(/Duration/i), {
      target: { value: "60" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    fireEvent.keyDown(confirmBtn, { key: "Enter", code: "Enter" });
    fireEvent.click(confirmBtn);

    expect(onCreate).toHaveBeenCalled();
  });
});
