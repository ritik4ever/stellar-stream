import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateCreateStreamFee, getConfig } from "../services/api";
import { CreateStreamForm } from "./CreateStreamForm";

const SENDER = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";

vi.mock("../services/api", () => ({
  estimateCreateStreamFee: vi.fn(),
  getConfig: vi.fn(),
}));

describe("CreateStreamForm asset picker boundary states (SSB-2026-016)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders explicit boundary tag and fallback input when asset metadata fails to load", async () => {
    vi.mocked(getConfig).mockRejectedValueOnce(new Error("RPC asset fetch failed"));

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const boundaryTag = await screen.findByTestId("boundary-metadata-failed");
    expect(boundaryTag).toBeInTheDocument();
    expect(boundaryTag).toHaveTextContent("Asset metadata failed to load");

    // Fallback text input is rendered
    expect(screen.getByPlaceholderText("e.g. USDC")).toBeInTheDocument();
    expect(screen.getByTestId("retry-asset-config")).toBeInTheDocument();
  });

  it("renders explicit boundary tag when allowed asset list is empty", async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: [] });

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const boundaryTag = await screen.findByTestId("boundary-empty-assets");
    expect(boundaryTag).toBeInTheDocument();
    expect(boundaryTag).toHaveTextContent("No allowed assets configured");
  });

  it("renders asset dropdown when allowed assets are successfully loaded", async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ allowedAssets: ["USDC", "XLM", "EURC"] });

    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    const select = await screen.findByRole("combobox", { name: /Asset Code/i });
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "USDC" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "XLM" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "EURC" })).toBeInTheDocument();

    expect(screen.queryByTestId("boundary-metadata-failed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("boundary-empty-assets")).not.toBeInTheDocument();
  });
});
