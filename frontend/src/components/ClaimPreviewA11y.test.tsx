import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ClaimBatchModal } from "./ClaimBatchModal";
import type { BatchClaimState } from "../hooks/useClaimBatch";

describe("Claim preview accessibility and keyboard navigation (SSB-2026-063)", () => {
  afterEach(() => {
    cleanup();
  });

  it("closes modal on Escape key press when not claiming", () => {
    const readyState: BatchClaimState = {
      phase: "ready",
      claimableByStreamId: { "stream-a11y-1": 100 },
      totalClaimable: 100,
      assetLabel: "USDC",
      progress: { current: 0, total: 1 },
      failures: [],
      successCount: 0,
      error: null,
    };

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ClaimBatchModal
        state={readyState}
        streamCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close modal on Escape key press while claiming is in flight", () => {
    const claimingState: BatchClaimState = {
      phase: "claiming",
      claimableByStreamId: { "stream-a11y-1": 100 },
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

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders polite live region announcer with accessible state descriptions", () => {
    const readyState: BatchClaimState = {
      phase: "ready",
      claimableByStreamId: { "stream-a11y-1": 250 },
      totalClaimable: 250,
      assetLabel: "USDC",
      progress: { current: 0, total: 1 },
      failures: [],
      successCount: 0,
      error: null,
    };

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <ClaimBatchModal
        state={readyState}
        streamCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const announcer = screen.getByTestId("claim-a11y-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent("Claim preview ready: Claim 250.0000 USDC across 1 stream");

    // Rerender in complete state
    const completeState: BatchClaimState = {
      ...readyState,
      phase: "complete",
      progress: { current: 1, total: 1 },
      successCount: 1,
    };

    rerender(
      <ClaimBatchModal
        state={completeState}
        streamCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    expect(announcer).toHaveTextContent("Batch claim complete. 1 of 1 claims succeeded.");
  });

  it("enforces accessible dialog semantics and button labeling", () => {
    const readyState: BatchClaimState = {
      phase: "ready",
      claimableByStreamId: { "stream-a11y-1": 50 },
      totalClaimable: 50,
      assetLabel: "XLM",
      progress: { current: 0, total: 1 },
      failures: [],
      successCount: 0,
      error: null,
    };

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ClaimBatchModal
        state={readyState}
        streamCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "claim-batch-title");
    expect(dialog).toHaveAttribute("aria-describedby", "claim-batch-summary");
  });
});
