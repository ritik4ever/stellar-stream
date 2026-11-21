import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ClaimBatchModal } from "./ClaimBatchModal";
import type { BatchClaimState } from "../hooks/useClaimBatch";

describe("Claim preview error recovery path (SSB-2026-062)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders actionable recovery box and retry button when wallet rejects signature", () => {
    const errorState: BatchClaimState = {
      phase: "complete",
      claimableByStreamId: { "stream-rec-1": 100 },
      totalClaimable: 100,
      assetLabel: "USDC",
      progress: { current: 1, total: 1 },
      failures: [{ streamId: "stream-rec-1", message: "User rejected signature in wallet" }],
      successCount: 0,
      error: null,
    };

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ClaimBatchModal
        state={errorState}
        streamCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const recoveryBox = screen.getByTestId("claim-error-recovery");
    expect(recoveryBox).toBeInTheDocument();
    expect(screen.getByText("Wallet Signature Rejected")).toBeInTheDocument();

    const errorMsg = screen.getByTestId("claim-error-message");
    expect(errorMsg).toHaveTextContent("User rejected signature in wallet");

    const retryBtn = screen.getByTestId("claim-retry-btn");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).toHaveTextContent("Retry claim");

    // Click retry
    fireEvent.click(retryBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("handles top-level state error gracefully with recovery retry action", () => {
    const topErrorState: BatchClaimState = {
      phase: "idle",
      claimableByStreamId: { "stream-rec-1": 100 },
      totalClaimable: 100,
      assetLabel: "XLM",
      progress: { current: 0, total: 1 },
      failures: [],
      successCount: 0,
      error: "Wallet disconnected or signature declined by user",
    };

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ClaimBatchModal
        state={topErrorState}
        streamCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const recoveryBox = screen.getByTestId("claim-error-recovery");
    expect(recoveryBox).toBeInTheDocument();

    const retryBtn = screen.getByTestId("claim-retry-btn");
    fireEvent.click(retryBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate action submission while claiming is actively in flight", () => {
    const claimingState: BatchClaimState = {
      phase: "claiming",
      claimableByStreamId: { "stream-rec-1": 100 },
      totalClaimable: 100,
      assetLabel: "USDC",
      progress: { current: 1, total: 1 },
      failures: [],
      successCount: 0,
      error: null,
    };

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ClaimBatchModal
        state={claimingState}
        streamCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    // During claiming, retry button is not present and claiming button is disabled
    expect(screen.queryByTestId("claim-retry-btn")).not.toBeInTheDocument();
    const claimingBtn = screen.getByRole("button", { name: "Claiming…" });
    expect(claimingBtn).toBeDisabled();
    expect(claimingBtn).toHaveAttribute("aria-busy", "true");
  });

  it("allows safe dismissal via cancel button in failure state", () => {
    const failureState: BatchClaimState = {
      phase: "complete",
      claimableByStreamId: { "stream-rec-1": 50 },
      totalClaimable: 50,
      assetLabel: "USDC",
      progress: { current: 1, total: 1 },
      failures: [{ streamId: "stream-rec-1", message: "Transaction submission timed out" }],
      successCount: 0,
      error: null,
    };

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ClaimBatchModal
        state={failureState}
        streamCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const cancelBtn = screen.getByTestId("claim-cancel-btn");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
