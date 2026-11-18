import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateCreateStreamFee, getConfig } from "../services/api";
import { CreateStreamForm } from "./CreateStreamForm";

const VALID_SENDER = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
const VALID_RECIPIENT = "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E";
const MALFORMED_ADDRESS = "INVALID_NOT_STELLAR_KEY";

vi.mock("../services/api", () => ({
  estimateCreateStreamFee: vi.fn(),
  getConfig: vi.fn(),
}));

function fillBaseForm(sender = VALID_SENDER, recipient = VALID_RECIPIENT) {
  fireEvent.change(screen.getByLabelText(/Sender Account/i), {
    target: { value: sender },
  });
  fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
    target: { value: recipient },
  });
  fireEvent.change(screen.getByLabelText(/Total Amount/i), {
    target: { value: "100" },
  });
  fireEvent.change(screen.getByLabelText(/Duration/i), {
    target: { value: "60" },
  });
}

describe("CreateStreamForm recipient edge and failure states (SSB-2026-015)", () => {
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

  it("flags malformed Stellar recipient address and blocks form submission", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={VALID_SENDER} />);

    fillBaseForm(VALID_SENDER, MALFORMED_ADDRESS);
    const recipientInput = screen.getByLabelText(/Recipient Account/i);
    fireEvent.blur(recipientInput);

    expect(screen.getByText(/Account IDs must start with the letter G/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toBeDisabled();
  });

  it("flags self-addressed stream where recipient equals sender", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={VALID_SENDER} />);

    fillBaseForm(VALID_SENDER, VALID_SENDER);
    const recipientInput = screen.getByLabelText(/Recipient Account/i);
    fireEvent.blur(recipientInput);

    expect(screen.getByText(/Recipient cannot be the same as sender/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toBeDisabled();
  });

  it("prevents confirmation and surfaces error if connected wallet changes during submission", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <CreateStreamForm onCreate={onCreate} walletAddress={VALID_SENDER} />
    );

    fillBaseForm(VALID_SENDER, VALID_RECIPIENT);

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    expect(confirmBtn).toBeInTheDocument();

    // Rerender with a changed connected wallet
    const CHANGED_WALLET = "GNEWWALLET6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
    rerender(<CreateStreamForm onCreate={onCreate} walletAddress={CHANGED_WALLET} />);

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Connected wallet does not match the stream sender/i)
      ).toBeInTheDocument();
    });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("prevents confirmation if wallet disconnects while confirmation modal is open", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <CreateStreamForm onCreate={onCreate} walletAddress={VALID_SENDER} />
    );

    fillBaseForm(VALID_SENDER, VALID_RECIPIENT);

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    expect(confirmBtn).toBeInTheDocument();

    // Disconnect wallet
    rerender(<CreateStreamForm onCreate={onCreate} walletAddress={null} />);

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/Wallet disconnected/i)).toBeInTheDocument();
    });
    expect(onCreate).not.toHaveBeenCalled();
  });
});
