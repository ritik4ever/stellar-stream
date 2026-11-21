import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WalletButton } from "./WalletButton";
import type { FreighterState } from "../hooks/useFreighter";

describe("Wallet connection boundary states (SSB-2026-076)", () => {
  const mockConnect = vi.fn();
  const mockDisconnect = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders explicit state tag when wallet extension is unavailable", () => {
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

    expect(screen.getByTestId("boundary-extension-unavailable")).toHaveTextContent(
      "Extension unavailable"
    );
    const installBtn = screen.getByRole("button", { name: /Install Freighter/i });
    expect(installBtn).toBeInTheDocument();
    expect(installBtn).toHaveAttribute(
      "title",
      "Freighter extension not detected — install it from freighter.app"
    );
  });

  it("renders explicit boundary state and disables action when network passphrase mismatches", () => {
    const wallet: FreighterState = {
      installed: true,
      allowed: false,
      address: null,
      status: "error",
      error: "Network passphrase mismatch: Freighter is set to Mainnet instead of Testnet.",
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    render(<WalletButton wallet={wallet} />);

    // Boundary tag is rendered
    expect(screen.getByTestId("boundary-network-mismatch")).toHaveTextContent(
      "Network passphrase mismatch"
    );

    // Error alert is rendered
    expect(screen.getByRole("alert")).toHaveTextContent("Network passphrase mismatch");

    // Primary action button is NOT misleadingly ready-to-act
    const mismatchBtn = screen.getByRole("button", {
      name: /Wrong Network \(Testnet Required\)/i,
    });
    expect(mismatchBtn).toBeInTheDocument();
    expect(mismatchBtn).toBeDisabled();
    expect(mismatchBtn).toHaveAttribute("aria-disabled", "true");
    expect(mismatchBtn).toHaveAttribute(
      "title",
      "Network passphrase mismatch — switch your wallet to Testnet"
    );
  });

  it("preserves actionable Connect Wallet button when installed without network errors", () => {
    const wallet: FreighterState = {
      installed: true,
      allowed: false,
      address: null,
      status: "idle",
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    render(<WalletButton wallet={wallet} />);

    expect(screen.queryByTestId("boundary-extension-unavailable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("boundary-network-mismatch")).not.toBeInTheDocument();

    const connectBtn = screen.getByRole("button", { name: /Connect Wallet/i });
    expect(connectBtn).toBeInTheDocument();
    expect(connectBtn).not.toBeDisabled();
  });
});
