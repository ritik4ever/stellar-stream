import React from "react";
import { ListStreamsFilters } from "../services/api";

interface EmptyStateProps {
  filters: ListStreamsFilters;
  onClearFilters: () => void;
  onCreateStream?: () => void;
  hasAnyStreams: boolean;
}

export function EmptyState({
  filters,
  onClearFilters,
  onCreateStream,
  hasAnyStreams,
}: EmptyStateProps) {
  // Determine which filter is active to show contextual message
  const getEmptyMessage = (): string => {
    if (filters.status) {
      const statusMessages: Record<string, string> = {
        active: "No active streams",
        scheduled: "No scheduled streams",
        completed: "No completed streams",
        canceled: "No canceled streams",
      };
      return statusMessages[filters.status] || `No streams with status "${filters.status}"`;
    }
    
    if (filters.sender) {
      return "No streams from this sender";
    }
    
    if (filters.recipient) {
      return "No streams to this recipient";
    }
    
    if (filters.asset) {
      return `No streams with asset "${filters.asset}"`;
    }
    
    if (filters.q) {
      return "No streams match your search";
    }
    
    // No filters active
    return hasAnyStreams ? "No streams match your filters" : "No streams yet";
  };

  const hasActiveFilters = Object.values(filters).some(
    (value) => value && value.trim() !== ""
  );

  return (
    <div className="empty-state" style={{ textAlign: "center", padding: "3rem 1rem" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📭</div>
      <h3 style={{ marginBottom: "0.5rem", color: "var(--color-text-primary)" }}>
        {getEmptyMessage()}
      </h3>
      <p className="muted" style={{ marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        {hasActiveFilters
          ? "Try adjusting your filters or clear them to see all streams."
          : "Create your first stream to get started."}
      </p>
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
        {hasActiveFilters && (
          <button
            type="button"
            className="btn-primary"
            onClick={onClearFilters}
            style={{ fontSize: "0.9rem" }}
          >
            Clear Filters
          </button>
        )}
        {!hasAnyStreams && onCreateStream && (
          <button
            type="button"
            className="btn-primary"
            onClick={onCreateStream}
            style={{ fontSize: "0.9rem" }}
          >
            Create Stream
          </button>
        )}
      </div>
    </div>
  );
}
