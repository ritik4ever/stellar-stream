import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CreateStreamForm } from "../../src/components/CreateStreamForm";
import { estimateCreateStreamFee, getConfig } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
  estimateCreateStreamFee: vi.fn(),
  getConfig: vi.fn(),
}));

const WALLET_ADDRESS = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";

describe("CreateStreamForm snapshots", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    vi.mocked(getConfig).mockResolvedValue({ allowedAssets: ["USDC", "XLM"] });
    vi.mocked(estimateCreateStreamFee).mockResolvedValue({
      feeStroops: 12345,
      feeXlm: "0.0012345",
    });
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it("matches snapshot in default state with connected wallet", async () => {
    const { container } = render(
      <CreateStreamForm onCreate={vi.fn()} walletAddress={WALLET_ADDRESS} />,
    );
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot when API error is displayed", async () => {
    const { container } = render(
      <CreateStreamForm
        onCreate={vi.fn()}
        walletAddress={WALLET_ADDRESS}
        apiError="Insufficient balance for stream escrow"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Insufficient or stale balance/i)).toBeInTheDocument();
    });
    expect(container.firstChild).toMatchSnapshot();
  });
});
