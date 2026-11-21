import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateCreateStreamFee, getConfig } from "../services/api";
import { CreateStreamForm } from "./CreateStreamForm";

const SENDER = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
const RECIPIENT = "GD6W5F67P6D2M3H6C4U7O8P9Q1R2S3T4U5V6W7X8Y9Z0A1B2C3D4E5F6";

vi.mock("../services/api", () => ({
  estimateCreateStreamFee: vi.fn(),
  getConfig: vi.fn(),
}));

describe("CreateStreamForm asset picker accessibility (SSB-2026-018)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("supports keyboard navigation, announces selected asset status, and preserves accessible review confirmation", async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: ["USDC", "XLM", "EURC"] });
    vi.mocked(estimateCreateStreamFee).mockResolvedValueOnce({ feeXlm: "0.01" });

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    // Combobox rendered with accessible label
    const select = await screen.findByRole("combobox", { name: /Asset Code/i });
    expect(select).toBeInTheDocument();

    // Verify polite status announcement region
    const statusHint = screen.getByRole("status");
    expect(statusHint).toHaveAttribute("aria-live", "polite");
    expect(statusHint).toHaveTextContent(/Selected asset: USDC/i);

    // Keyboard change to XLM
    fireEvent.change(select, { target: { value: "XLM" } });
    expect(statusHint).toHaveTextContent(/Selected asset: XLM/i);

    // Fill valid sender and recipient
    const senderInput = screen.getByLabelText(/Sender Account/i);
    const recipientInput = screen.getByLabelText(/Recipient Account/i);
    fireEvent.change(senderInput, { target: { value: SENDER } });
    fireEvent.change(recipientInput, { target: { value: RECIPIENT } });

    // Submit form to open confirmation modal
    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    // Verify confirmation modal opens with accessible attributes
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const modal = screen.getByRole("dialog");
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(modal).toHaveAttribute("aria-labelledby", "fee-preview-title");

    // Review prompt displays selected asset code with explicit row label
    const assetReviewVal = screen.getByTestId("preview-asset-code");
    expect(assetReviewVal).toHaveTextContent("XLM");
    expect(assetReviewVal).toHaveAttribute("aria-labelledby", "review-asset-code-dt");

    // Total amount row is also labeled
    const totalAmountVal = screen.getByTestId("preview-total-amount");
    expect(totalAmountVal).toHaveTextContent("150 XLM");
    expect(totalAmountVal).toHaveAttribute("aria-labelledby", "review-total-amount-dt");

    // Escape closes confirmation prompt
    fireEvent.keyDown(screen.getByRole("presentation"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
