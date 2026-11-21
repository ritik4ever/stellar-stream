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

describe("CreateStreamForm amount keyboard and screen reader accessibility (SSB-2026-003)", () => {
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

  it("supports keyboard-only focus navigation across asset selector and amount field", async () => {
    const user = userEvent.setup();
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const assetSelect = screen.getByLabelText(/Asset Code/i);
    const amountInput = screen.getByLabelText(/Total Amount/i);

    await user.tab(); // Focus sender
    await user.tab(); // Focus recipient
    await user.tab(); // Focus asset selector
    expect(assetSelect).toHaveFocus();

    await user.tab(); // Focus amount input
    expect(amountInput).toHaveFocus();
  });

  it("announces amount hint in polite live region without repeating disruptive alerts", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const amountInput = screen.getByLabelText(/Total Amount/i);
    expect(amountInput).toHaveAttribute("aria-describedby", "amount-hint");

    const hint = screen.getByText(/Enter a positive number/i);
    expect(hint).toHaveAttribute("aria-live", "polite");
  });

  it("links error state with aria-describedby and role=alert when amount is invalid", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const amountInput = screen.getByLabelText(/Total Amount/i);
    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.blur(amountInput);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/greater than zero/i);
    expect(amountInput).toHaveAttribute("aria-invalid", "true");
  });

  it("operates confirmation prompt via keyboard and dismisses with Escape key", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fireEvent.change(screen.getByLabelText(/Sender Account/i), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(screen.getByLabelText(/Total Amount/i), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText(/Duration/i), {
      target: { value: "60" },
    });

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("500 USDC")).toBeInTheDocument();

    // Press Escape to dismiss
    fireEvent.keyDown(dialog.parentElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
