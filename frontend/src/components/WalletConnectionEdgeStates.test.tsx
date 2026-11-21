import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WalletButton } from "./WalletButton";
import type { FreighterState } from "../hooks/useFreighter";

describe("Wallet connection edge and failure states (SSB-2026-080)", () => {
  const mockConnect = vi.fn();
  const mockDisconnect = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Network passphrase mismatch edge state", () => {
    it("asserts visible boundary tag, alert messaging, and safely disables action controls", () => {
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

      // Boundary tag assertion
      const boundaryTag = screen.getByTestId("boundary-network-mismatch");
      expect(boundaryTag).toBeInTheDocument();
      expect(boundaryTag).toHaveTextContent("Network passphrase mismatch");

      // Accessible error alert
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(mismatchError);

      // Primary action button is safely disabled to prevent network pollution
      const actionBtn = screen.getByTestId("wallet-mismatch-btn");
      expect(actionBtn).toBeInTheDocument();
      expect(actionBtn).toBeDisabled();
      expect(actionBtn).toHaveAttribute("aria-disabled", "true");
      expect(actionBtn).toHaveTextContent("Wrong Network (Testnet Required)");

      // Actionable recovery path is available
      const retryBtn = screen.getByTestId("wallet-retry-btn");
      expect(retryBtn).toBeInTheDocument();
      expect(retryBtn).not.toBeDisabled();

      fireEvent.click(retryBtn);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("Wallet extension unavailable edge state", () => {
    it("asserts visible state, install guidance, and actionable recovery path", () => {
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

      // Asserts explicit boundary state tag
      const boundaryTag = screen.getByTestId("boundary-extension-unavailable");
      expect(boundaryTag).toBeInTheDocument();
      expect(boundaryTag).toHaveTextContent("Extension unavailable");

      // Asserts install button with guidance
      const installBtn = screen.getByTestId("wallet-connect-btn");
      expect(installBtn).toBeInTheDocument();
      expect(installBtn).toHaveTextContent("Install Freighter");
      expect(installBtn).toHaveAttribute(
        "title",
        "Freighter extension not detected — install it from freighter.app"
      );

      // Asserts in-situ retry button without page reload requirement
      const retryBtn = screen.getByTestId("wallet-retry-btn");
      expect(retryBtn).toBeInTheDocument();
      expect(retryBtn).toHaveTextContent("Retry Connection");

      fireEvent.click(retryBtn);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it("prevents duplicate actions during in-flight connecting state", () => {
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

      const connectingBtn = screen.getByTestId("wallet-connecting-btn");
      expect(connectingBtn).toBeDisabled();
      expect(connectingBtn).toHaveAttribute("aria-busy", "true");

      fireEvent.click(connectingBtn);
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });
});
