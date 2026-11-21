import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateCreateStreamFee, getConfig } from "../services/api";
import { CreateStreamForm } from "./CreateStreamForm";

const SENDER = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
const RECIPIENT = "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E";

vi.mock("../services/api", () => ({
  estimateCreateStreamFee: vi.fn(),
  getConfig: vi.fn(),
}));

function fillBaseForm(amount = "100") {
  fireEvent.change(screen.getByLabelText(/Sender Account/i), {
    target: { value: SENDER },
  });
  fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
    target: { value: RECIPIENT },
  });
  fireEvent.change(screen.getByLabelText(/Total Amount/i), {
    target: { value: amount },
  });
  fireEvent.change(screen.getByLabelText(/Duration/i), {
    target: { value: "60" },
  });
}

describe("CreateStreamForm amount edge and failure states (SSB-2026-005)", () => {
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

  it("accepts fractional amounts within 7 decimal places of Stellar precision", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm("12.3456789".slice(0, 10)); // "12.3456789" is 7 decimal places: 12.3456789 -> length after '.' is 7
    const amountInput = screen.getByLabelText(/Total Amount/i);
    fireEvent.change(amountInput, { target: { value: "12.3456789" } });
    fireEvent.blur(amountInput);

    expect(screen.queryByText(/Stellar precision/i)).not.toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it("rejects fractional amounts exceeding 7 decimal places with explicit validation message", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm("10");
    const amountInput = screen.getByLabelText(/Total Amount/i);
    // 8 decimal places: .12345678
    fireEvent.change(amountInput, { target: { value: "10.12345678" } });
    fireEvent.blur(amountInput);

    expect(
      screen.getByText(/Amount supports at most 7 decimal places \(Stellar precision\)/i)
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toBeDisabled();
  });

  it("rejects zero amount values and disables submission", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm("0");
    const amountInput = screen.getByLabelText(/Total Amount/i);
    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.blur(amountInput);

    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toBeDisabled();
  });

  it("surfaces humanised actionable error when API flags stale or insufficient balance", () => {
    render(
      <CreateStreamForm
        onCreate={vi.fn()}
        walletAddress={SENDER}
        apiError="Insufficient balance to fund stream"
      />
    );

    expect(screen.getByText(/Insufficient or stale balance/i)).toBeInTheDocument();
    expect(
      screen.getByText(/The sender's balance may be stale or too low/i)
    ).toBeInTheDocument();
  });

  it("handles rejected submit in confirmation modal and preserves safe action paths", async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error("Submit rejected: balance changed"));
    render(<CreateStreamForm onCreate={onCreate} walletAddress={SENDER} />);

    fillBaseForm("50");

    const submitButton = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitButton);

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    expect(confirmBtn).toBeInTheDocument();

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Submit rejected: balance changed");
    });

    const retryBtn = screen.getByRole("button", { name: /Retry Confirmation/i });
    const editBtn = screen.getByRole("button", { name: /Edit/i });

    expect(retryBtn).toBeInTheDocument();
    expect(editBtn).toBeInTheDocument();

    // Clicking Edit safely dismisses the modal to allow revising input
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Total Amount/i)).toHaveValue(50);
  });
});
