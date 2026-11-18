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

function fillBaseForm() {
  fireEvent.change(screen.getByLabelText(/Sender Account/i), {
    target: { value: SENDER },
  });
  fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
    target: { value: RECIPIENT },
  });
  fireEvent.change(screen.getByLabelText(/Total Amount/i), {
    target: { value: "250" },
  });
  fireEvent.change(screen.getByLabelText(/Duration/i), {
    target: { value: "120" },
  });
}

describe("CreateStreamForm recipient mobile usability (SSB-2026-014)", () => {
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

  it("renders recipient and sender in review step with break-all wrapping on 320px viewport", async () => {
    render(
      <div style={{ width: "320px", overflow: "hidden" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    fillBaseForm();

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    const recipientVal = await screen.findByTestId("preview-recipient");
    const senderVal = await screen.findByTestId("preview-sender");

    expect(recipientVal).toBeInTheDocument();
    expect(recipientVal).toHaveTextContent(RECIPIENT);
    expect(recipientVal).toHaveStyle({ wordBreak: "break-all" });

    expect(senderVal).toBeInTheDocument();
    expect(senderVal).toHaveTextContent(SENDER);
    expect(senderVal).toHaveStyle({ wordBreak: "break-all" });

    // Amount remains visible without being clipped
    expect(screen.getByText("250 USDC")).toBeInTheDocument();
  });

  it("preserves layout and displays full recipient at 768px tablet viewport", async () => {
    render(
      <div style={{ width: "768px" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    fillBaseForm();

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    const recipientVal = await screen.findByTestId("preview-recipient");
    expect(recipientVal).toHaveTextContent(RECIPIENT);
  });

  it("maintains 44px minimum touch targets on all review and submit action buttons", async () => {
    render(
      <div style={{ width: "320px" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    fillBaseForm();

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toHaveStyle({ minHeight: "44px" });

    fireEvent.click(submitBtn);

    const cancelBtn = await screen.findByRole("button", { name: /Cancel/i });
    const confirmBtn = screen.getByRole("button", { name: /^Confirm$/i });

    expect(cancelBtn).toHaveStyle({ minHeight: "44px" });
    expect(confirmBtn).toHaveStyle({ minHeight: "44px" });
  });
});
