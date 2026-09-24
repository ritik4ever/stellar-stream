import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listStreams } from "../services/api";
import type { Stream } from "../types/stream";

const DEBOUNCE_MS = 300;

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await listStreams({ q: trimmed, limit: 8 });
        setResults(result.data);
        setOpen(true);
        setActiveIndex(-1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const goToStream = (streamId: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/?streamId=${encodeURIComponent(streamId)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (target) goToStream(target.id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "260px" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search streams..."
        aria-label="Global stream search"
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
        className="input"
        style={{ width: "100%" }}
      />
      {open && (
        <div
          role="listbox"
          className="card"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 100,
            maxHeight: "320px",
            overflowY: "auto",
            padding: "0.25rem",
          }}
        >
          {loading && (
            <div style={{ padding: "0.5rem", fontSize: "0.85rem", color: "#9ca3af" }}>
              Searching…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div style={{ padding: "0.5rem", fontSize: "0.85rem", color: "#9ca3af" }}>
              No streams found.
            </div>
          )}
          {!loading &&
            results.map((stream, index) => (
              <div
                key={stream.id}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={() => goToStream(stream.id)}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  padding: "0.5rem 0.6rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  backgroundColor: index === activeIndex ? "rgba(59,130,246,0.15)" : "transparent",
                }}
              >
                <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                  {stream.id.slice(0, 10)}…
                </div>
                <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                  {stream.sender.slice(0, 6)}…{stream.sender.slice(-4)} →{" "}
                  {stream.recipient.slice(0, 6)}…{stream.recipient.slice(-4)} ·{" "}
                  {stream.totalAmount} {stream.assetCode}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}