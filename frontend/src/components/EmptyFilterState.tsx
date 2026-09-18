import React from "react";
interface Props { message: string; onClear: () => void; }
const EmptyFilterState: React.FC<Props> = ({ message, onClear }) => (
  <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
    <p style={{ fontSize: "18px", marginBottom: "1rem" }}>{message || "No results found"}</p>
    <button onClick={onClear} style={{ padding: "8px 16px", background: "#667eea", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>Clear Filters</button>
  </div>
);
export default EmptyFilterState;
