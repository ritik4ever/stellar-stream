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

describe("CreateStreamForm asset picker edge and failure states (SSB-2026-020)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(estimateCreateStreamFee).mockResolvedValue({
      feeStroops: 100,
      feeXlm: "0.00001",
    });
  });

  it("handles empty allowed-asset list by displaying boundary indicator and fallback text input", async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: [] });

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const boundaryTag = await screen.findByTestId("boundary-empty-assets");
    expect(boundaryTag).toBeInTheDocument();
    expect(boundaryTag).toHaveTextContent("No allowed assets configured");

    const textInput = screen.getByPlaceholderText("e.g. USDC");
    expect(textInput).toBeInTheDocument();
    expect(textInput).toHaveAttribute("id", "stream-asset");

    // Allows manual entry when configuration is empty
    fireEvent.change(textInput, { target: { value: "CUSTOMASSET" } });
    expect(textInput).toHaveValue("CUSTOMASSET");
  });

  it("dynamically defaults to USDC when allowed assets list changes and omits previous selection", async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: ["EURC", "USDC", "XLM"] });

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const select = await screen.findByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("USDC");
  });

  it("falls back to the first available asset when USDC is absent in changed asset list", async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: ["AQUA", "BTC"] });

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const select = await screen.findByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("AQUA");
  });

  it("handles asset metadata failing to load with visible error tag and retry recovery", async () => {
    vi.mocked(getConfig).mockRejectedValueOnce(new Error("RPC timeout fetching asset config"));

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const errorTag = await screen.findByTestId("boundary-metadata-failed");
    expect(errorTag).toBeInTheDocument();
    expect(errorTag).toHaveTextContent("Asset metadata failed to load");

    const retryBtn = screen.getByTestId("retry-asset-config");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).toHaveTextContent("Retry Loading Assets");

    // Resolves on retry
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: ["USDC", "XLM"] });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("boundary-metadata-failed")).not.toBeInTheDocument();
    });

    const restoredSelect = screen.getByRole("combobox");
    expect(restoredSelect).toBeInTheDocument();
    expect(restoredSelect).toHaveValue("USDC");
  });

  it("ensures safe action behavior by blocking stream submission when asset is empty", async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: [] });

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const textInput = await screen.findByPlaceholderText("e.g. USDC");
    fireEvent.change(textInput, { target: { value: "" } });
    fireEvent.blur(textInput);

    const submitBtn = screen.getByRole("button", { name: /Create Stream/i });
    fireEvent.click(submitBtn);

    // Form retains safe state without crashing or submitting invalid payload
    expect(estimateCreateStreamFee).not.toHaveBeenCalled();
  });
});
