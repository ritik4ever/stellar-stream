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

function fillBaseForm(duration = "60", startIn = "15") {
  fireEvent.change(screen.getByLabelText(/Sender Account/i), {
    target: { value: SENDER },
  });
  fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
    target: { value: RECIPIENT },
  });
  fireEvent.change(screen.getByLabelText(/Total Amount/i), {
    target: { value: "150" },
  });
  fireEvent.change(screen.getByLabelText(/Duration/i), {
    target: { value: duration },
  });
  fireEvent.change(screen.getByLabelText(/Start In/i), {
    target: { value: startIn },
  });
}

describe("CreateStreamForm schedule recovery path (SSB-2026-007)", () => {
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

  it("handles fee estimation clock skew error and recovers via Retry Estimation", async () => {
    vi.mocked(estimateCreateStreamFee)
      .mockRejectedValueOnce(new Error("Clock skew detected: request timestamp is in the past"))
      .mockResolvedValueOnce({
        feeStroops: 100,
        feeXlm: "0.00001",
      });

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm("60", "10");

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText(/Clock skew detected: request timestamp is in the past/i)
    ).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /Retry Estimation/i });
    expect(retryBtn).toBeInTheDocument();

    // Form inputs preserved
    expect(screen.getByLabelText(/Start In/i)).toHaveValue(10);
    expect(screen.getByLabelText(/Total Amount/i)).toHaveValue(150);

    // Clicking retry successfully re-attempts with refreshed timestamps
    fireEvent.click(retryBtn);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("150 USDC")).toBeInTheDocument();
  });

  it("surfaces humanised error and provides Retry Confirmation in review modal", async () => {
    const onCreate = vi.fn()
      .mockRejectedValueOnce(new Error("Timezone skew: transaction expired"))
      .mockResolvedValueOnce(undefined);

    render(<CreateStreamForm onCreate={onCreate} walletAddress={SENDER} />);

    fillBaseForm("60", "0");

    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    fireEvent.click(confirmBtn);

    expect(
      await screen.findByText(/Device clock or timezone mismatch/i)
    ).toBeInTheDocument();

    const retryConfirmBtn = screen.getByRole("button", { name: /Retry Confirmation/i });
    const editBtn = screen.getByRole("button", { name: /Edit/i });

    expect(retryConfirmBtn).toBeInTheDocument();
    expect(editBtn).toBeInTheDocument();

    // Clicking Retry Confirmation resolves stream creation
    fireEvent.click(retryConfirmBtn);

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("prevents duplicate actions during active retry confirmation", async () => {
    let resolveSubmit: () => void;
    const onCreate = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        })
    );

    render(<CreateStreamForm onCreate={onCreate} walletAddress={SENDER} />);

    fillBaseForm("60", "0");

    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn); // Double click

    expect(onCreate).toHaveBeenCalledTimes(1);

    resolveSubmit!();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
