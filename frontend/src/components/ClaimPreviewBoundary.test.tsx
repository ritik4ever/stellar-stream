import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ClaimBatchModal } from "./ClaimBatchModal";
import type { BatchClaimState } from "../hooks/useClaimBatch";

describe("Claim preview boundary states (SSB-2026-061)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders explicit zero claimable notice and disabled action when totalClaimable is 0", () => {
    const zeroState: BatchClaimState = {
      phase: "ready",
      claimableByStreamId: {
        "stream-1": 0,
        "stream-2": 0,
      },
      totalClaimable: 0,
      assetLabel: "USDC",
      progress: { current: 0, total: 0 },
      failures: [],
      successCount: 0,
      error: null,
    };

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ClaimBatchModal
        state={zeroState}
        streamCount={2}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const zeroNotice = screen.getByTestId("claim-preview-zero-notice");
    expect(zeroNotice).toBeInTheDocument();
    expect(zeroNotice).toHaveTextContent("No claimable balance");

    const confirmBtn = screen.getByTestId("claim-confirm-btn");
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn).toHaveTextContent("Nothing to claim");

    // Click should not trigger onConfirm
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders explicit partial claim notice and 'Confirm partial claim' button when only subset is claimable", () => {
    const partialState: BatchClaimState = {
      phase: "ready",
      claimableByStreamId: {
        "stream-1": 150,
        "stream-2": 0,
      },
      totalClaimable: 150,
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
        state={partialState}
        streamCount={2}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const partialNotice = screen.getByTestId("claim-preview-partial-notice");
    expect(partialNotice).toBeInTheDocument();
    expect(partialNotice).toHaveTextContent("Partial claim available");
    expect(partialNotice).toHaveTextContent("1 of 2 streams have vested funds ready to claim");

    const confirmBtn = screen.getByTestId("claim-confirm-btn");
    expect(confirmBtn).not.toBeDisabled();
    expect(confirmBtn).toHaveTextContent("Confirm partial claim");

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders standard summary and 'Confirm claim' when all streams have claimable balance", () => {
    const fullState: BatchClaimState = {
      phase: "ready",
      claimableByStreamId: {
        "stream-1": 100,
        "stream-2": 200,
      },
      totalClaimable: 300,
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
        state={fullState}
        streamCount={2}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    expect(screen.queryByTestId("claim-preview-zero-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("claim-preview-partial-notice")).not.toBeInTheDocument();

    const confirmBtn = screen.getByTestId("claim-confirm-btn");
    expect(confirmBtn).not.toBeDisabled();
    expect(confirmBtn).toHaveTextContent("Confirm claim");

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("allows closing modal via cancel button", () => {
    const readyState: BatchClaimState = {
      phase: "ready",
      claimableByStreamId: { "stream-1": 50 },
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

    const cancelBtn = screen.getByTestId("claim-cancel-btn");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
