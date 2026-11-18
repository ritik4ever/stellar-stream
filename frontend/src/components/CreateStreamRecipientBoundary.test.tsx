import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

function fillBaseForm(sender = SENDER, recipient = RECIPIENT) {
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

describe("CreateStreamForm recipient boundary states (SSB-2026-011)", () => {
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

  it("renders explicit malformed address boundary tag and disables submission", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm(SENDER, "NOT_A_VALID_KEY");
    const recipientInput = screen.getByLabelText(/Recipient Account/i);
    fireEvent.blur(recipientInput);

    const boundaryTag = screen.getByTestId("boundary-malformed-recipient");
    expect(boundaryTag).toBeInTheDocument();
    expect(boundaryTag).toHaveTextContent("Malformed address boundary");

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toBeDisabled();
  });

  it("renders explicit self-addressed boundary tag and disables submission", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm(SENDER, SENDER);
    const recipientInput = screen.getByLabelText(/Recipient Account/i);
    fireEvent.blur(recipientInput);

    const boundaryTag = screen.getByTestId("boundary-self-addressed");
    expect(boundaryTag).toBeInTheDocument();
    expect(boundaryTag).toHaveTextContent("Self-addressed boundary");

    expect(screen.getByText(/Recipient cannot be the same as sender/i)).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toBeDisabled();
  });

  it("clears boundary error states and enables submission when valid recipient is supplied", () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm(SENDER, RECIPIENT);
    const recipientInput = screen.getByLabelText(/Recipient Account/i);
    fireEvent.blur(recipientInput);

    expect(screen.queryByTestId("boundary-malformed-recipient")).not.toBeInTheDocument();
    expect(screen.queryByTestId("boundary-self-addressed")).not.toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).not.toBeDisabled();
  });
});
