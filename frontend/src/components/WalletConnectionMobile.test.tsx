import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WalletButton } from "./WalletButton";
import type { FreighterState } from "../hooks/useFreighter";

const LONG_ADDRESS = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
const SWITCHED_ADDRESS = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

describe("Wallet connection mobile and narrow screen usability (SSB-2026-079)", () => {
  const mockConnect = vi.fn();
  const mockDisconnect = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders connected wallet without horizontal clipping on 320px narrow viewport", () => {
    const wallet: FreighterState = {
      installed: true,
      allowed: true,
      address: LONG_ADDRESS,
      status: "connected",
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <WalletButton wallet={wallet} />
      </div>
    );

    const container = screen.getByTestId("wallet-status-container");
    expect(container).toBeInTheDocument();
    expect(container).toHaveStyle({
      maxWidth: "100%",
      flexWrap: "wrap",
      boxSizing: "border-box",
    });

    const addressBadge = screen.getByTestId("wallet-connected-address");
    expect(addressBadge).toHaveStyle({
      minHeight: "44px",
      overflowWrap: "anywhere",
      wordBreak: "break-all",
    });

    const disconnectBtn = screen.getByTestId("wallet-disconnect-btn");
    expect(disconnectBtn).toHaveStyle({
      minHeight: "44px",
      minWidth: "44px",
    });
  });

  it("enforces minimum 44px touch targets on action and recovery controls", () => {
    const wallet: FreighterState = {
      installed: false,
      allowed: false,
      address: null,
      status: "idle",
      error: "Freighter extension not detected",
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    render(
      <div style={{ width: "320px" }}>
        <WalletButton wallet={wallet} />
      </div>
    );

    const installBtn = screen.getByTestId("wallet-connect-btn");
    const retryBtn = screen.getByTestId("wallet-retry-btn");

    expect(installBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
    expect(retryBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });

  it("maintains touch target and layout integrity on 768px tablet viewport after account switch", () => {
    const wallet: FreighterState = {
      installed: true,
      allowed: true,
      address: LONG_ADDRESS,
      status: "connected",
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    const { rerender } = render(
      <div style={{ width: "768px" }}>
        <WalletButton wallet={wallet} />
      </div>
    );

    expect(screen.getByTestId("wallet-connected-address")).toHaveStyle({ minHeight: "44px" });

    // Switch account
    const switchedWallet: FreighterState = {
      ...wallet,
      address: SWITCHED_ADDRESS,
    };
    rerender(
      <div style={{ width: "768px" }}>
        <WalletButton wallet={switchedWallet} />
      </div>
    );

    const updatedBadge = screen.getByTestId("wallet-connected-address");
    expect(updatedBadge).toHaveTextContent("GA7Q…VSGZ");
    expect(updatedBadge).toHaveStyle({ minHeight: "44px" });
    expect(screen.getByTestId("wallet-disconnect-btn")).toHaveStyle({ minHeight: "44px" });
  });
});
