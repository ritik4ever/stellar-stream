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

describe("CreateStreamForm asset picker mobile usability (SSB-2026-019)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockResolvedValue({ allowedAssets: ["USDC", "XLM", "LONGASSETCODE12"] });
    vi.mocked(estimateCreateStreamFee).mockResolvedValue({
      feeStroops: 100,
      feeXlm: "0.00001",
    });
  });

  it("renders asset picker select with 44px touch target and wrapping hint on 320px viewport", async () => {
    render(
      <div style={{ width: "320px", overflow: "hidden" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    const assetSelect = await screen.findByRole("combobox");
    expect(assetSelect).toBeInTheDocument();
    expect(assetSelect).toHaveStyle({ minHeight: "44px" });
    expect(assetSelect).toHaveStyle({ width: "100%" });

    const hint = screen.getByText(/Selected asset:/i);
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveStyle({ wordBreak: "break-all" });
  });

  it("renders fallback text input with 44px touch target when allowed assets list is empty", async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: [] });

    render(
      <div style={{ width: "320px" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    const emptyTag = await screen.findByTestId("boundary-empty-assets");
    expect(emptyTag).toBeInTheDocument();
    expect(emptyTag).toHaveStyle({ wordBreak: "break-word" });

    const assetInput = screen.getByPlaceholderText(/e\.g\. USDC/i);
    expect(assetInput).toBeInTheDocument();
    expect(assetInput).toHaveStyle({ minHeight: "44px" });
  });

  it("handles asset metadata failure state with responsive retry action on narrow screens", async () => {
    vi.mocked(getConfig).mockRejectedValueOnce(new Error("Network Error"));

    render(
      <div style={{ width: "320px" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    const failedTag = await screen.findByTestId("boundary-metadata-failed");
    expect(failedTag).toBeInTheDocument();
    expect(failedTag).toHaveStyle({ wordBreak: "break-word" });

    const retryBtn = screen.getByTestId("retry-asset-config");
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);

    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("maintains layout and visibility at 768px tablet viewport without clipping", async () => {
    render(
      <div style={{ width: "768px" }}>
        <CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />
      </div>
    );

    const assetSelect = await screen.findByRole("combobox");
    expect(assetSelect).toBeInTheDocument();

    const amountInput = screen.getByLabelText(/Total Amount/i);
    expect(amountInput).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toHaveStyle({ minHeight: "44px" });
  });
});
