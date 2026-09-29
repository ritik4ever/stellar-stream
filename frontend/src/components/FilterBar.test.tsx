import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FilterBar } from "./FilterBar";
import { ListStreamsFilters } from "../services/api";
import { useUrlFilters } from "../hooks/useUrlFilters";

describe("FilterBar Component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockFilters: ListStreamsFilters = {
    status: "",
    q: "",
    asset: "",
  };

  it("calls onChange when text input changes", () => {
    const handleChange = vi.fn();
    render(<FilterBar filters={mockFilters} onChange={handleChange} />);
    
    const searchInput = screen.getByLabelText(/Search ID \/ Address/i);
    fireEvent.change(searchInput, { target: { value: "test-id", name: "q" } });
    
    expect(handleChange).toHaveBeenCalledWith(expect.objectContaining({ q: "test-id" }));
  });

  it("calls onChange with correct filters when Scheduled preset is clicked", () => {
    const handleChange = vi.fn();
    render(<FilterBar filters={mockFilters} onChange={handleChange} />);
    
    const scheduledBtn = screen.getByRole("button", { name: /Scheduled/i });
    fireEvent.click(scheduledBtn);
    
    expect(handleChange).toHaveBeenCalledWith({
      status: "scheduled",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    });
  });

  it("calls onChange with correct filters when At-Risk preset is clicked", () => {
    const handleChange = vi.fn();
    render(<FilterBar filters={mockFilters} onChange={handleChange} />);
    
    const atRiskBtn = screen.getByRole("button", { name: /At-Risk/i });
    fireEvent.click(atRiskBtn);
    
    expect(handleChange).toHaveBeenCalledWith({
      status: "active",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    });
  });

  it("calls onChange with empty filters when Reset is clicked", () => {
    const handleChange = vi.fn();
    const activeFilters = { status: "active", q: "some-query" };
    render(<FilterBar filters={activeFilters} onChange={handleChange} />);
    
    const resetBtn = screen.getByText(/Reset All/i);
    fireEvent.click(resetBtn);
    
    expect(handleChange).toHaveBeenCalledWith({
      status: "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    });
  });
});

describe("FilterBar URL Sync Integration", () => {
  const originalLocation = window.location;
  const originalHistory = window.history;

  // jsdom exposes `location`/`history` as accessor properties, so they have to
  // be redefined rather than assigned.
  const stubWindowProp = (key: "location" | "history", value: unknown) => {
    Object.defineProperty(window, key, {
      value,
      configurable: true,
      writable: true,
    });
  };

  beforeEach(() => {
    stubWindowProp("location", {
      search: "",
      pathname: "/",
      href: "http://localhost/",
    });

    stubWindowProp("history", {
      replaceState: vi.fn(),
      pushState: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      go: vi.fn(),
      length: 1,
      state: null,
    });
  });

  afterEach(() => {
    // Restore original window.location and window.history
    stubWindowProp("location", originalLocation);
    stubWindowProp("history", originalHistory);
    cleanup();
    vi.clearAllMocks();
  });

  it("updates URL query param when status filter is changed to 'active' with URL sync enabled", () => {
    const handleChange = vi.fn();
    const setUrlFilters = vi.fn();
    const mockFilters: ListStreamsFilters = {
      status: "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    };

    render(
      <FilterBar
        filters={mockFilters}
        onChange={handleChange}
        setUrlFilters={setUrlFilters}
      />
    );

    const statusSelect = screen.getByLabelText(/Status/i);
    fireEvent.change(statusSelect, { target: { value: "active" } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" })
    );
    expect(setUrlFilters).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", page: 1 })
    );
  });

  it("does not update URL when useUrlFilters is disabled", () => {
    const handleChange = vi.fn();
    const mockFilters: ListStreamsFilters = {
      status: "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    };

    render(<FilterBar filters={mockFilters} onChange={handleChange} useUrlFilters={false} />);

    const statusSelect = screen.getByLabelText(/Status/i);
    fireEvent.change(statusSelect, { target: { value: "active" } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" })
    );
    expect(handleChange).toHaveBeenCalledWith(
      expect.not.objectContaining({ page: 1 })
    );
  });

  it("updates asset param when asset filter changes with URL sync enabled", () => {
    const handleChange = vi.fn();
    const setUrlFilters = vi.fn();
    const mockFilters: ListStreamsFilters = {
      status: "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    };

    render(
      <FilterBar
        filters={mockFilters}
        onChange={handleChange}
        setUrlFilters={setUrlFilters}
      />
    );

    const assetInput = screen.getByLabelText(/Asset Code/i);
    fireEvent.change(assetInput, { target: { value: "USDC", name: "asset" } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ asset: "USDC" })
    );
    expect(setUrlFilters).toHaveBeenCalledWith(
      expect.objectContaining({ asset: "USDC", page: 1 })
    );
  });

  it("resets to page 1 when Reset button is clicked with URL sync enabled", () => {
    const handleChange = vi.fn();
    const setUrlFilters = vi.fn();
    const activeFilters: ListStreamsFilters = {
      status: "active",
      q: "test",
      asset: "USDC",
      sender: "",
      recipient: "",
    };

    render(
      <FilterBar
        filters={activeFilters}
        onChange={handleChange}
        setUrlFilters={setUrlFilters}
      />
    );

    const resetBtn = screen.getByText(/Reset All/i);
    fireEvent.click(resetBtn);

    expect(handleChange).toHaveBeenCalledWith({
      status: "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    });
    expect(setUrlFilters).toHaveBeenCalledWith({
      status: "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
      page: 1,
    });
  });

  it("restores filter state from URL on page load with ?status=completed", () => {
    (window as any).location.search = "?status=completed";

    const { result } = renderHook(() => useUrlFilters());

    expect(result.current.filters.status).toBe("completed");
  });

  it("restores filter state from URL with multiple params", () => {
    (window as any).location.search = "?status=active&asset=USDC";

    const { result } = renderHook(() => useUrlFilters());

    expect(result.current.filters.status).toBe("active");
    expect(result.current.filters.asset).toBe("USDC");
  });

  it("updates q param when search input has 3+ characters", () => {
    const handleChange = vi.fn();
    const setUrlFilters = vi.fn();
    const mockFilters: ListStreamsFilters = {
      status: "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    };

    render(
      <FilterBar
        filters={mockFilters}
        onChange={handleChange}
        setUrlFilters={setUrlFilters}
      />
    );

    const searchInput = screen.getByLabelText(/Search ID \/ Address/i);
    fireEvent.change(searchInput, { target: { value: "abc", name: "q" } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ q: "abc" })
    );
    expect(setUrlFilters).toHaveBeenCalledWith(
      expect.objectContaining({ q: "abc", page: 1 })
    );
  });

  it("handles invalid status values in URL by defaulting to empty", () => {
    (window as any).location.search = "?status=invalid";

    const { result } = renderHook(() => useUrlFilters());

    expect(result.current.filters.status).toBe("");
  });

  it("handles empty URL params correctly", () => {
    (window as any).location.search = "";

    const { result } = renderHook(() => useUrlFilters());

    expect(result.current.filters.status).toBe("");
    expect(result.current.filters.asset).toBe("");
    expect(result.current.filters.sender).toBe("");
    expect(result.current.filters.recipient).toBe("");
  });
});
