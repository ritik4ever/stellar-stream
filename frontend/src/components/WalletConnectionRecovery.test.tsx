import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WalletButton } from "./WalletButton";
import type { FreighterState } from "../hooks/useFreighter";

describe("Wallet connection recovery path (SSB-2026-077)", () => {
  const mockConnect = vi.fn();
  const mockDisconnect = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("handles wallet extension unavailable with an actionable retry path", () => {
    const wallet: FreighterState = {
      installed: false,
      allowed: false,
      address: null,
      status: "idle",
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    render(<WalletButton wallet={wallet} />);

    // Boundary indicator
    expect(screen.getByTestId("boundary-extension-unavailable")).toHaveTextContent(
      "Extension unavailable"
    );

    // Install button available
    expect(screen.getByRole("button", { name: /Install Freighter/i })).toBeInTheDocument();

    // Actionable retry button is present
    const retryBtn = screen.getByTestId("wallet-retry-btn");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toBeDisabled();

    // Clicking retry triggers connection probe
    fireEvent.click(retryBtn);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("shows useful error message on simulated failure, supports retry, and prevents duplicate actions", () => {
    const errorMsg = "Freighter request timed out. Please check your extension.";
    const wallet: FreighterState = {
      installed: true,
      allowed: false,
      address: null,
      status: "error",
      error: errorMsg,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    const { rerender } = render(<WalletButton wallet={wallet} />);

    // Useful error message in alert role
    const alertBox = screen.getByRole("alert");
    expect(alertBox).toHaveTextContent(errorMsg);

    // Retry button is available
    const retryBtn = screen.getByTestId("wallet-retry-btn");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toBeDisabled();

    fireEvent.click(retryBtn);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Rerender in connecting state to verify no duplicate action can be sent
    const connectingWallet: FreighterState = {
      ...wallet,
      status: "connecting",
    };
    rerender(<WalletButton wallet={connectingWallet} />);

    const connectingBtn = screen.getByRole("button", { name: /Connecting…/i });
    expect(connectingBtn).toBeDisabled();
    expect(connectingBtn).toHaveAttribute("aria-busy", "true");

    fireEvent.click(connectingBtn);
    // mockConnect still 1, no duplicate dispatch!
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("handles network passphrase mismatch with clear instructions and retry path", () => {
    const mismatchError = "Network passphrase mismatch: Freighter is set to Mainnet instead of Testnet.";
    const wallet: FreighterState = {
      installed: true,
      allowed: false,
      address: null,
      status: "error",
      error: mismatchError,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    render(<WalletButton wallet={wallet} />);

    expect(screen.getByTestId("boundary-network-mismatch")).toHaveTextContent(
      "Network passphrase mismatch"
    );

    // Primary action button is safely disabled
    const mismatchBtn = screen.getByRole("button", {
      name: /Wrong Network \(Testnet Required\)/i,
    });
    expect(mismatchBtn).toBeDisabled();

    // Actionable retry button is available once user corrects the network
    const retryBtn = screen.getByTestId("wallet-retry-btn");
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
