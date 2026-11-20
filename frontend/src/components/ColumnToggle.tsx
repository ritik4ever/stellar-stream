import { useState } from "react";

export interface ColumnConfig {
  key: string;
  label: string;
  defaultVisible: boolean;
}

interface ColumnToggleProps {
  columns: ColumnConfig[];
  visibleColumns: Set<string>;
  onToggle: (key: string) => void;
}

export function ColumnToggle({ columns, visibleColumns, onToggle }: ColumnToggleProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="column-toggle" style={{ position: "relative" }}>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen(!open)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        ⚙ Columns
      </button>
      {open && (
        <div
          className="column-toggle__dropdown"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 10,
            background: "var(--color-background)",
            border: "1px solid var(--color-border)",
            borderRadius: "6px",
            padding: "0.5rem",
            minWidth: "180px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {columns.map((col) => (
            <label
              key={col.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.25rem 0",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <input
                type="checkbox"
                checked={visibleColumns.has(col.key)}
                onChange={() => onToggle(col.key)}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
