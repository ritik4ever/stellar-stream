import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ClaimBatchModal } from "./ClaimBatchModal";
import type { BatchClaimState } from "../hooks/useClaimBatch";

describe("Claim preview mobile responsiveness on narrow screens (SSB-2026-064)", () => {
  afterEach(() => {
    cleanup();
  });

  const baseReadyState: BatchClaimState = {
    phase: "ready",
    claimableByStreamId: {
      "stream-GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6": 125.5432,
    },
    totalClaimable: 125.5432,
    assetLabel: "USDC",
    progress: { current: 0, total: 1 },
    failures: [],
    successCount: 0,
    error: null,
  };

  it("renders Claim preview container with overflow wrapping on 320px narrow viewport", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <ClaimBatchModal
          state={baseReadyState}
          streamCount={1}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </div>
    );

    const modal = screen.getByTestId("claim-preview-modal");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveStyle({
      maxWidth: "100%",
      boxSizing: "border-box",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });

    const summary = screen.getByTestId("claim-preview-summary");
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveStyle({
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });
  });

  it("enforces minimum 44px touch targets and flex wrapping on action buttons", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <div style={{ width: "320px" }}>
        <ClaimBatchModal
          state={baseReadyState}
          streamCount={1}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </div>
    );

    const cancelBtn = screen.getByTestId("claim-cancel-btn");
    const confirmBtn = screen.getByTestId("claim-confirm-btn");

    expect(cancelBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
    expect(confirmBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });

    const actionsContainer = screen.getByTestId("claim-modal-actions");
    expect(actionsContainer).toHaveStyle({
      display: "flex",
      flexWrap: "wrap",
    });
  });

  it("maintains touch target usability and text wrapping for zero claimable boundary notice", () => {
    const zeroState: BatchClaimState = {
      ...baseReadyState,
      claimableByStreamId: { "stream-zero-1": 0 },
      totalClaimable: 0,
    };

    render(
      <div style={{ width: "320px" }}>
        <ClaimBatchModal
          state={zeroState}
          streamCount={1}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );

    const notice = screen.getByTestId("claim-preview-zero-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveStyle({
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });

    const disabledBtn = screen.getByTestId("claim-confirm-btn");
    expect(disabledBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });

  it("maintains touch target usability for partial claim confirmation", () => {
    const partialState: BatchClaimState = {
      ...baseReadyState,
      claimableByStreamId: {
        "stream-partial-1": 50,
        "stream-partial-2": 0,
      },
      totalClaimable: 50,
    };

    render(
      <div style={{ width: "320px" }}>
        <ClaimBatchModal
          state={partialState}
          streamCount={2}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );

    const partialNotice = screen.getByTestId("claim-preview-partial-notice");
    expect(partialNotice).toBeInTheDocument();
    expect(partialNotice).toHaveStyle({
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });

    const confirmPartialBtn = screen.getByTestId("claim-confirm-btn");
    expect(confirmPartialBtn).toHaveTextContent("Confirm partial claim");
    expect(confirmPartialBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });

  it("handles wallet signature rejection with responsive error recovery controls at 320px and 768px widths", () => {
    const rejectedState: BatchClaimState = {
      phase: "ready",
      claimableByStreamId: { "stream-1": 100 },
      totalClaimable: 100,
      assetLabel: "USDC",
      progress: { current: 0, total: 1 },
      failures: [
        {
          streamId: "stream-long-account-GD765432109876543210987654321098765432109876543210987654",
          message: "User declined signature in Stellar wallet extension.",
        },
        {
          streamId: "stream-long-account-GB987654321098765432109876543210987654321098765432109876",
          message: "Transaction submission timeout on Horizon.",
        },
      ],
      successCount: 0,
      error: "User declined signature in Stellar wallet extension.",
    };

    const { rerender } = render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <ClaimBatchModal
          state={rejectedState}
          streamCount={2}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );

    const recoveryBox = screen.getByTestId("claim-error-recovery");
    expect(recoveryBox).toBeInTheDocument();
    expect(recoveryBox).toHaveStyle({
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });

    const errorMsg = screen.getByTestId("claim-error-message");
    expect(errorMsg).toHaveStyle({
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });

    const retryBtn = screen.getByTestId("claim-retry-btn");
    const cancelBtn = screen.getByTestId("claim-cancel-btn");
    expect(retryBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
    expect(cancelBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });

    // Test at 768px tablet viewport
    rerender(
      <div style={{ width: "768px" }}>
        <ClaimBatchModal
          state={rejectedState}
          streamCount={2}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );
    expect(screen.getByTestId("claim-retry-btn")).toHaveStyle({ minHeight: "44px" });
  });

  it("enforces minimum 44px touch target on completion close button", () => {
    const completeState: BatchClaimState = {
      phase: "complete",
      claimableByStreamId: { "stream-1": 100 },
      totalClaimable: 100,
      assetLabel: "USDC",
      progress: { current: 1, total: 1 },
      failures: [],
      successCount: 1,
      error: null,
    };

    render(
      <div style={{ width: "320px" }}>
        <ClaimBatchModal
          state={completeState}
          streamCount={1}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );

    const closeBtn = screen.getByTestId("claim-close-btn");
    expect(closeBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });
});
