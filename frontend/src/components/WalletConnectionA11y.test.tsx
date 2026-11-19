import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WalletButton } from "./WalletButton";
import type { FreighterState } from "../hooks/useFreighter";

const ADDR_1 = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const ADDR_2 = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E";

describe("Wallet connection keyboard and screen reader accessibility (SSB-2026-078)", () => {
  const mockConnect = vi.fn();
  const mockDisconnect = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("announces connected address and exposes accessible keyboard focus", () => {
    const wallet: FreighterState = {
      installed: true,
      allowed: true,
      address: ADDR_1,
      status: "connected",
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    render(<WalletButton wallet={wallet} />);

    // Connected address badge is focusable for screen readers/keyboard users
    const addressBadge = screen.getByLabelText(`Connected wallet address: ${ADDR_1}`);
    expect(addressBadge).toBeInTheDocument();
    expect(addressBadge).toHaveAttribute("tabindex", "0");

    // Status announcement polite live region
    const announcement = screen.getByTestId("wallet-status-announcement");
    expect(announcement).toHaveAttribute("role", "status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveAttribute("aria-atomic", "true");
    expect(announcement).toHaveTextContent("Wallet connected: GA7Q…VSGZ");

    // Accessible disconnect button
    const disconnectBtn = screen.getByRole("button", { name: "Disconnect wallet GA7Q…VSGZ" });
    expect(disconnectBtn).toBeInTheDocument();
  });

  it("announces account switch politely when connected address changes", () => {
    const wallet1: FreighterState = {
      installed: true,
      allowed: true,
      address: ADDR_1,
      status: "connected",
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    const { rerender } = render(<WalletButton wallet={wallet1} />);

    // Rerender with switched account
    const wallet2: FreighterState = {
      ...wallet1,
      address: ADDR_2,
    };
    rerender(<WalletButton wallet={wallet2} />);

    const announcement = screen.getByTestId("wallet-status-announcement");
    expect(announcement).toHaveTextContent("Wallet account switched to GBX5…6U4E");

    const newBadge = screen.getByLabelText(`Connected wallet address: ${ADDR_2}`);
    expect(newBadge).toBeInTheDocument();
  });

  it("ensures keyboard operation for disconnect and announces disconnected state", () => {
    const wallet: FreighterState = {
      installed: true,
      allowed: true,
      address: ADDR_1,
      status: "connected",
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    const { rerender } = render(<WalletButton wallet={wallet} />);

    const disconnectBtn = screen.getByRole("button", { name: "Disconnect wallet GA7Q…VSGZ" });
    fireEvent.click(disconnectBtn);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    // Transition to idle state
    const disconnectedWallet: FreighterState = {
      ...wallet,
      address: null,
      allowed: false,
      status: "idle",
    };
    rerender(<WalletButton wallet={disconnectedWallet} />);

    const announcement = screen.getByTestId("wallet-status-announcement");
    expect(announcement).toHaveTextContent("Wallet disconnected");
  });

  it("exposes aria-busy and disabled state during connecting without alert spam", () => {
    const wallet: FreighterState = {
      installed: true,
      allowed: false,
      address: null,
      status: "connecting",
      error: null,
      connect: mockConnect,
      disconnect: mockDisconnect,
      signAction: vi.fn(),
    };

    render(<WalletButton wallet={wallet} />);

    const btn = screen.getByRole("button", { name: /Connecting…/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");

    const announcement = screen.getByTestId("wallet-status-announcement");
    expect(announcement).toHaveTextContent("Connecting to wallet…");
  });
});
