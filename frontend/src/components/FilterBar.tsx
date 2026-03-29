import React from "react";
import { ListStreamsFilters } from "../services/api";

interface FilterBarProps {
  filters: ListStreamsFilters;
  onChange: (filters: ListStreamsFilters) => void;
}

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Canceled", value: "canceled" },
];

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onChange({ ...filters, [name]: value });
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...filters, status: e.target.value });
  };

  const applyPreset = (preset: Partial<ListStreamsFilters>) => {
    // Presets clear other search/identity filters to focus on the monitoring view
    onChange({
      status: preset.status || "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
      ...preset,
    });
  };

  const handleReset = () => {
    onChange({
      status: "",
      q: "",
      asset: "",
      sender: "",
      recipient: "",
    });
  };

  return (
    <div className="filter-bar card" style={{ marginBottom: "1.5rem", padding: "1.25rem" }}>
      <div className="filter-grid" style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div className="field-group">
          <label htmlFor="q">Search ID / Address</label>
          <input
            id="q"
            name="q"
            type="text"
            placeholder="Search..."
            value={filters.q || ""}
            onChange={handleTextChange}
          />
        </div>

        <div className="field-group">
          <label htmlFor="status">Status</label>
          <select
            id="status"
            value={filters.status || ""}
            onChange={handleStatusChange}
            style={{
              border: "1.5px solid #d1d5db",
              borderRadius: "8px",
              minHeight: "38px",
              padding: "0.45rem 0.6rem",
              fontSize: "0.9rem",
              outline: "none"
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor="asset">Asset Code</label>
          <input
            id="asset"
            name="asset"
            type="text"
            placeholder="e.g. USDC"
            value={filters.asset || ""}
            onChange={handleTextChange}
          />
        </div>
      </div>

      <div className="presets-row" style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", borderTop: "1px solid #f3f4f6", paddingTop: "1.25rem" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#6b7280" }}>Bulk Presets:</span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => applyPreset({ status: "scheduled" })}
          style={{ fontSize: "0.85rem" }}
        >
          📅 Scheduled
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => applyPreset({ status: "active" })}
          style={{ fontSize: "0.85rem" }}
        >
          ⚠️ At-Risk (Active)
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => applyPreset({ status: "completed" })}
          style={{ fontSize: "0.85rem" }}
        >
          ✅ Completed
        </button>
        
        <div style={{ marginLeft: "auto" }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleReset}
            style={{ fontSize: "0.85rem", color: "#6b7280" }}
          >
            Reset All
          </button>
        </div>
      </div>
    </div>
  );
}
