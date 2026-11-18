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

describe("CreateStreamForm asset picker recovery path (SSB-2026-017)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows actionable retry path on failure and preserves form draft inputs", async () => {
    vi.mocked(getConfig).mockRejectedValueOnce(new Error("Network timeout loading assets"));

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    // Shows failure boundary message
    const boundaryTag = await screen.findByTestId("boundary-metadata-failed");
    expect(boundaryTag).toBeInTheDocument();
    expect(boundaryTag).toHaveTextContent(/Asset metadata failed to load/i);

    // Verify retry button exists and is enabled
    const retryBtn = screen.getByTestId("retry-asset-config");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toBeDisabled();

    // User types recipient and custom asset while in fallback mode
    const recipientInput = screen.getByPlaceholderText(/G… \(56-character Stellar public key\)/i);
    fireEvent.change(recipientInput, { target: { value: RECIPIENT } });
    expect(recipientInput).toHaveValue(RECIPIENT);

    const assetInput = screen.getByPlaceholderText("e.g. USDC");
    fireEvent.change(assetInput, { target: { value: "CUSTOM" } });
    expect(assetInput).toHaveValue("CUSTOM");

    // Mock successful recovery on retry
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: ["USDC", "XLM", "CUSTOM"] });

    fireEvent.click(retryBtn);

    // Verify successful retry populates allowed assets and preserves valid selected asset
    await waitFor(() => {
      expect(screen.queryByTestId("boundary-metadata-failed")).not.toBeInTheDocument();
    });

    const select = screen.getByRole("combobox", { name: /Asset Code/i });
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("CUSTOM");

    // Recipient input value is still preserved
    expect(recipientInput).toHaveValue(RECIPIENT);
  });

  it("prevents duplicate actions during in-flight retry", async () => {
    let resolveConfigPromise: (value: { allowedAssets: string[] }) => void;
    const pendingPromise = new Promise<{ allowedAssets: string[] }>((resolve) => {
      resolveConfigPromise = resolve;
    });

    vi.mocked(getConfig)
      .mockRejectedValueOnce(new Error("Initial failure"))
      .mockReturnValueOnce(pendingPromise);

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const retryBtn = await screen.findByTestId("retry-asset-config");
    expect(retryBtn).toBeInTheDocument();

    // Trigger retry
    fireEvent.click(retryBtn);

    // Button should be disabled during in-flight request
    expect(retryBtn).toBeDisabled();
    expect(retryBtn).toHaveTextContent(/Retrying/i);

    // Duplicate clicks do not trigger extra calls
    fireEvent.click(retryBtn);
    expect(getConfig).toHaveBeenCalledTimes(2); // Initial mount + 1 retry

    // Complete the pending retry
    resolveConfigPromise!({ allowedAssets: ["USDC", "XLM"] });

    await waitFor(() => {
      expect(screen.queryByTestId("boundary-metadata-failed")).not.toBeInTheDocument();
    });
  });
});
