import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateCreateStreamFee, getConfig } from "../services/api";
import { CreateStreamForm } from "./CreateStreamForm";

const SENDER = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
const RECIPIENT = "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E";

vi.mock("../services/api", () => ({
  estimateCreateStreamFee: vi.fn(),
  getConfig: vi.fn(),
}));

function fillBaseForm(duration = "60", startIn = "0") {
  fireEvent.change(screen.getByLabelText(/Sender Account/i), {
    target: { value: SENDER },
  });
  fireEvent.change(screen.getByLabelText(/Recipient Account/i), {
    target: { value: RECIPIENT },
  });
  fireEvent.change(screen.getByLabelText(/Total Amount/i), {
    target: { value: "100" },
  });
  fireEvent.change(screen.getByLabelText(/Duration/i), {
    target: { value: duration },
  });
  fireEvent.change(screen.getByLabelText(/Start In/i), {
    target: { value: startIn },
  });
}

describe("CreateStreamForm schedule boundary states (SSB-2026-006)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockResolvedValue({ allowedAssets: ["USDC", "XLM"] });
    vi.mocked(estimateCreateStreamFee).mockResolvedValue({
      feeStroops: 100,
      feeXlm: "0.00001",
    });
  });

  it("renders explicit boundary tag for start time at the current-minute boundary", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm("60", "0");

    const boundaryTag = await screen.findByTestId("boundary-current-minute");
    expect(boundaryTag).toBeInTheDocument();
    expect(boundaryTag).toHaveTextContent("Current-minute boundary");

    const preview = screen.getByTestId("schedule-preview");
    expect(preview).toHaveTextContent("Starts immediately (current minute)");
  });

  it("distinguishes device clock / timezone mismatch boundary state and blocks submission", () => {
    render(
      <CreateStreamForm
        onCreate={vi.fn()}
        walletAddress={SENDER}
        apiError="Clock skew detected: device timestamp differs from network time"
      />
    );

    fillBaseForm("60", "0");

    expect(screen.getByText(/Device clock or timezone mismatch/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Your device clock differs from Stellar network time/i)
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Clock Out of Sync/i });
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute(
      "title",
      "Device clock mismatch — please sync your device time to proceed"
    );
  });

  it("renders scheduled UTC start time when start offset is provided", async () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={SENDER} />);

    fillBaseForm("120", "45");

    const preview = await screen.findByTestId("schedule-preview");
    expect(screen.queryByTestId("boundary-current-minute")).not.toBeInTheDocument();
    expect(preview).toHaveTextContent(/Starts:/i);
    expect(preview).toHaveTextContent(/Ends:/i);
    expect(preview).toHaveTextContent("UTC");
  });
});
