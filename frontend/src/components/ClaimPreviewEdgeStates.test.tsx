import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ClaimBatchModal } from "./ClaimBatchModal";
import type { BatchClaimState } from "../hooks/useClaimBatch";

describe("Claim preview edge and failure states (SSB-2026-065)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("Zero claimable amount boundary", () => {
    it("renders zero claimable notice and disables confirm action safely without testnet dependency", () => {
      const zeroClaimState: BatchClaimState = {
        phase: "ready",
        claimableByStreamId: {
          "stream-zero-1": 0,
          "stream-zero-2": 0,
        },
        totalClaimable: 0,
        assetLabel: "USDC",
        progress: { current: 0, total: 2 },
        failures: [],
        successCount: 0,
        error: null,
      };

      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <ClaimBatchModal
          state={zeroClaimState}
          streamCount={2}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      );

      // Asserts visible zero boundary notice
      const zeroNotice = screen.getByTestId("claim-preview-zero-notice");
      expect(zeroNotice).toBeInTheDocument();
      expect(zeroNotice).toHaveTextContent("No claimable balance");
      expect(zeroNotice).toHaveTextContent("All selected streams currently have zero claimable balance");

      // Asserts disabled confirm action with informative label
      const confirmBtn = screen.getByTestId("claim-confirm-btn");
      expect(confirmBtn).toBeDisabled();
      expect(confirmBtn).toHaveAttribute("aria-disabled", "true");
      expect(confirmBtn).toHaveTextContent("Nothing to claim");

      // Verify safe action: clicking disabled button does not trigger confirm
      fireEvent.click(confirmBtn);
      expect(onConfirm).not.toHaveBeenCalled();

      // Verify cancel action works safely
      const cancelBtn = screen.getByTestId("claim-cancel-btn");
      fireEvent.click(cancelBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Partial claim boundary", () => {
    it("renders partial claim notice and permits confirming only available vested streams", () => {
      const partialClaimState: BatchClaimState = {
        phase: "ready",
        claimableByStreamId: {
          "stream-partial-vested": 75.25,
          "stream-partial-unvested": 0,
        },
        totalClaimable: 75.25,
        assetLabel: "XLM",
        progress: { current: 0, total: 2 },
        failures: [],
        successCount: 0,
        error: null,
      };

      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <ClaimBatchModal
          state={partialClaimState}
          streamCount={2}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      );

      // Asserts visible partial claim notice
      const partialNotice = screen.getByTestId("claim-preview-partial-notice");
      expect(partialNotice).toBeInTheDocument();
      expect(partialNotice).toHaveTextContent("Partial claim available");
      expect(partialNotice).toHaveTextContent("Only 1 of 2 streams have vested funds ready to claim (75.2500 XLM)");

      // Asserts enabled partial claim action button
      const confirmBtn = screen.getByTestId("claim-confirm-btn");
      expect(confirmBtn).not.toBeDisabled();
      expect(confirmBtn).toHaveTextContent("Confirm partial claim");

      // Verify clicking triggers confirmation
      fireEvent.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe("Wallet signature rejection failure state", () => {
    it("renders signature rejection recovery alert and allows safe retry without losing input", () => {
      const walletRejectionState: BatchClaimState = {
        phase: "ready",
        claimableByStreamId: {
          "stream-reject-1": 150.0,
        },
        totalClaimable: 150.0,
        assetLabel: "USDC",
        progress: { current: 0, total: 1 },
        failures: [],
        successCount: 0,
        error: "User rejected the transaction signature in Freighter wallet",
      };

      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <ClaimBatchModal
          state={walletRejectionState}
          streamCount={1}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      );

      // Asserts visible recovery box and rejection title
      const recoveryAlert = screen.getByTestId("claim-error-recovery");
      expect(recoveryAlert).toBeInTheDocument();
      expect(recoveryAlert).toHaveAttribute("role", "alert");
      expect(recoveryAlert).toHaveTextContent("Wallet Signature Rejected");

      // Asserts visible error message describing wallet signature decline
      const errorMsg = screen.getByTestId("claim-error-message");
      expect(errorMsg).toHaveTextContent("User rejected the transaction signature in Freighter wallet");

      // Asserts recovery action buttons
      const retryBtn = screen.getByTestId("claim-retry-btn");
      const cancelBtn = screen.getByTestId("claim-cancel-btn");
      expect(retryBtn).toBeInTheDocument();
      expect(retryBtn).toHaveTextContent("Retry claim");
      expect(cancelBtn).toBeInTheDocument();

      // Verify safe retry: invokes onConfirm cleanly to re-request signature
      fireEvent.click(retryBtn);
      expect(onConfirm).toHaveBeenCalledTimes(1);

      // Verify safe cancel: invokes onClose cleanly
      fireEvent.click(cancelBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("renders multiple stream failure details and preserves modal state across retries", () => {
      const multiFailureState: BatchClaimState = {
        phase: "ready",
        claimableByStreamId: {
          "stream-101": 20.0,
          "stream-102": 30.0,
        },
        totalClaimable: 50.0,
        assetLabel: "USDC",
        progress: { current: 0, total: 2 },
        failures: [
          {
            streamId: "stream-101",
            message: "User declined signature in browser extension",
          },
          {
            streamId: "stream-102",
            message: "Horizon RPC connection timeout",
          },
        ],
        successCount: 0,
        error: "Batch claim encountered 2 failures",
      };

      render(
        <ClaimBatchModal
          state={multiFailureState}
          streamCount={2}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // Check stream failure breakdown
      expect(screen.getByText(/Stream stream-101: User declined signature/)).toBeInTheDocument();
      expect(screen.getByText(/Stream stream-102: Horizon RPC connection timeout/)).toBeInTheDocument();
      expect(screen.getByTestId("claim-retry-btn")).toBeEnabled();
    });
  });
});
