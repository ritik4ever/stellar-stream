import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateCreateStreamFee, getConfig } from "../services/api";
import { CreateStreamForm } from "./CreateStreamForm";

const SENDER = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
const RECIPIENT = "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E";
const CHANGED_WALLET = "GNEWACCOUNT4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E";

vi.mock("../services/api", () => ({
  estimateCreateStreamFee: vi.fn(),
  getConfig: vi.fn(),
}));

function fillBaseForm() {
  fireEvent.change(screen.getByLabelText(/Sender Account/i), {
    target: { value: SENDER },
  });
  fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
    target: { value: RECIPIENT },
  });
  fireEvent.change(screen.getByLabelText(/Total Amount/i), {
    target: { value: "120" },
  });
  fireEvent.change(screen.getByLabelText(/Duration/i), {
    target: { value: "60" },
  });
}

describe("CreateStreamForm recipient recovery path (SSB-2026-012)", () => {
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

  it("handles changed wallet during confirmation with actionable recovery alert", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <CreateStreamForm onCreate={onCreate} walletAddress={SENDER} />
    );

    fillBaseForm();

    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    expect(confirmBtn).toBeInTheDocument();

    // User switches wallet account in extension
    rerender(<CreateStreamForm onCreate={onCreate} walletAddress={CHANGED_WALLET} />);

    fireEvent.click(confirmBtn);

    expect(
      await screen.findByText(/Connected wallet does not match the stream sender/i)
    ).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    // User switches wallet account back to original sender
    rerender(<CreateStreamForm onCreate={onCreate} walletAddress={SENDER} />);

    const retryBtn = screen.getByRole("button", { name: /Retry Confirmation/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("allows Edit action to return to form while preserving entered recipient input", async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error("RPC submission rejected"));
    render(<CreateStreamForm onCreate={onCreate} walletAddress={SENDER} />);

    fillBaseForm();

    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    fireEvent.click(confirmBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent("RPC submission rejected");

    const editBtn = screen.getByRole("button", { name: /Edit/i });
    fireEvent.click(editBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Recipient Account/i)).toHaveValue(RECIPIENT);
    expect(screen.getByLabelText(/Total Amount/i)).toHaveValue(120);
  });

  it("prevents duplicate submissions when Retry Confirmation is clicked rapidly", async () => {
    let resolveAction: () => void;
    const onCreate = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        })
    );

    render(<CreateStreamForm onCreate={onCreate} walletAddress={SENDER} />);

    fillBaseForm();

    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    const confirmBtn = await screen.findByRole("button", { name: /^Confirm$/i });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn); // Double click

    expect(onCreate).toHaveBeenCalledTimes(1);

    resolveAction!();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
