import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VestingBar } from "../../src/components/VestingBar";

describe("VestingBar snapshots", () => {
  it("matches snapshot for active partial vesting", () => {
    const { container } = render(
      <VestingBar
        percentComplete={50}
        vestedAmount={500}
        totalAmount={1000}
        remainingAmount={500}
        assetCode="USDC"
        status="active"
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot for completed vesting", () => {
    const { container } = render(
      <VestingBar
        percentComplete={100}
        vestedAmount={1000}
        totalAmount={1000}
        remainingAmount={0}
        assetCode="XLM"
        status="completed"
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot with clamped out-of-range percentages", () => {
    const { container } = render(
      <div>
        <VestingBar percentComplete={-10} label="Underflow bar" />
        <VestingBar percentComplete={140} label="Overflow bar" />
      </div>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
