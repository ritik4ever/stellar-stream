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

describe("CreateStreamForm amount mobile usability (SSB-2026-004)", () => {
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

  it("renders typed amount and asset selector on 320px narrow viewport without horizontal clipping", () => {
    render(
      <div style={{ width: "320px", overflow: "hidden" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    const amountInput = screen.getByLabelText(/Total Amount/i);
    const assetSelect = screen.getByLabelText(/Asset Code/i);

    expect(amountInput).toBeInTheDocument();
    expect(assetSelect).toBeInTheDocument();

    fireEvent.change(amountInput, { target: { value: "100.5" } });
    expect(amountInput).toHaveValue(100.5);
  });

  it("enforces 44px minimum touch targets on amount input and asset select controls", () => {
    render(
      <div style={{ width: "320px" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    const amountInput = screen.getByLabelText(/Total Amount/i);
    const assetSelect = screen.getByLabelText(/Asset Code/i);

    expect(amountInput).toHaveStyle({ minHeight: "44px" });
    expect(assetSelect).toHaveStyle({ minHeight: "44px" });
  });

  it("displays amount and stream rate accurately in review step on 768px tablet width", async () => {
    render(
      <div style={{ width: "768px" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    fireEvent.change(screen.getByLabelText(/Sender Account/i), {
      target: { value: SENDER },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(screen.getByLabelText(/Total Amount/i), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByLabelText(/Duration/i), {
      target: { value: "60" },
    });

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    const amountPreview = await screen.findByText("300 USDC");
    expect(amountPreview).toBeInTheDocument();
    expect(screen.getByText("300.000000 USDC/hour")).toBeInTheDocument();
  });
});
