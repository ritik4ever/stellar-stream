import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FilterBar } from "./FilterBar";
import { ListStreamsFilters } from "../services/api";

describe("FilterBar Component", () => {
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
    
    const scheduledBtn = screen.getByText(/Scheduled/i);
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
    
    const atRiskBtn = screen.getByText(/At-Risk/i);
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
