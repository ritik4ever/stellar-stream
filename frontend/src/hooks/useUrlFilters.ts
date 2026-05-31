import { useCallback, useEffect, useState } from "react";
import type { ListStreamsFilters } from "../services/api";

export type ViewMode = "dashboard" | "recipient" | "sender";
export type SortField = "createdAt" | "amount" | "status" | "deadline";
export type SortDir = "asc" | "desc";

export interface ExtendedFilters extends ListStreamsFilters {
  sort?: string;
  page?: number;
}

const VALID_STATUSES = new Set(["active", "scheduled", "completed", "canceled"]);
const VALID_VIEWS = new Set<ViewMode>(["dashboard", "recipient", "sender"]);
const VALID_SORT_FIELDS = new Set<SortField>(["createdAt", "amount", "status", "deadline"]);

function sanitizeString(raw: string | null, maxLen = 64): string {
    if (!raw) return "";
    return raw.trim().replace(/[^\x20-\x7E]/g, "").slice(0, maxLen);
}

function parseViewMode(raw: string | null): ViewMode {
    const v = sanitizeString(raw);
    return VALID_VIEWS.has(v as ViewMode) ? (v as ViewMode) : "dashboard";
}

function parseStatus(raw: string | null): string {
    const v = sanitizeString(raw);
    return VALID_STATUSES.has(v) ? v : "";
}

function parseSort(raw: string | null): string {
    const v = sanitizeString(raw).toLowerCase();
    const parts = v.split("-");
    if (parts.length === 2 && VALID_SORT_FIELDS.has(parts[0] as SortField) && (parts[1] === "asc" || parts[1] === "desc")) {
        return v;
    }
    // Also accept plain field name (default desc)
    if (VALID_SORT_FIELDS.has(v as SortField)) {
        return `${v}-desc`;
    }
    return "";
}

function parsePage(raw: string | null): number {
    const v = parseInt(raw ?? "", 10);
    return Number.isFinite(v) && v >= 1 ? v : 1;
}

function readParams(): { view: ViewMode; filters: ExtendedFilters; streamId: string | null } {
    const p = new URLSearchParams(window.location.search);
    const rawStreamId = sanitizeString(p.get("streamId"), 128);
    return {
        view: parseViewMode(p.get("view")),
        streamId: rawStreamId || null,
        filters: {
            status: parseStatus(p.get("status")),
            asset: sanitizeString(p.get("asset")),
            sender: sanitizeString(p.get("sender")),
            recipient: sanitizeString(p.get("recipient")),
            sort: parseSort(p.get("sort")),
            page: parsePage(p.get("page")),
        },
    };
}

function buildSearch(view: ViewMode, filters: ExtendedFilters, streamId: string | null): string {
    const p = new URLSearchParams();
    if (view !== "dashboard") p.set("view", view);
    if (filters.status) p.set("status", filters.status);
    if (filters.asset) p.set("asset", filters.asset);
    if (filters.sender) p.set("sender", filters.sender);
    if (filters.recipient) p.set("recipient", filters.recipient);
    if (filters.sort) p.set("sort", filters.sort);
    if (filters.page && filters.page > 1) p.set("page", String(filters.page));
    if (streamId) p.set("streamId", streamId);
    const s = p.toString();
    return s ? `?${s}` : "";
}

export interface UrlFilterState {
    view: ViewMode;
    filters: ExtendedFilters;
    streamId: string | null;
    setView: (v: ViewMode) => void;
    setFilters: (f: ExtendedFilters) => void;
    openStream: (id: string) => void;
    closeStream: () => void;
}

export function useUrlFilters(): UrlFilterState {
    const initial = readParams();
    const [view, setViewState] = useState<ViewMode>(initial.view);
    const [filters, setFiltersState] = useState<ExtendedFilters>(initial.filters);
    const [streamId, setStreamIdState] = useState<string | null>(initial.streamId);

    useEffect(() => {
        const next = buildSearch(view, filters, streamId);
        const current = window.location.search;
        if (next !== current) {
            window.history.replaceState(null, "", next || window.location.pathname);
        }
    }, [view, filters, streamId]);

    useEffect(() => {
        function onPop() {
            const { view: v, filters: f, streamId: s } = readParams();
            setViewState(v);
            setFiltersState(f);
            setStreamIdState(s);
        }
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    const setView = useCallback((v: ViewMode) => {
        setViewState(v);
        const next = buildSearch(v, filters, streamId);
        window.history.pushState(null, "", next || window.location.pathname);
    }, [filters, streamId]);

    const setFilters = useCallback((f: ExtendedFilters) => {
        setFiltersState(f);
    }, []);

    const openStream = useCallback((id: string) => {
        setStreamIdState(id);
        const next = buildSearch(view, filters, id);
        window.history.pushState(null, "", next || window.location.pathname);
    }, [view, filters]);

    const closeStream = useCallback(() => {
        setStreamIdState(null);
        const next = buildSearch(view, filters, null);
        window.history.pushState(null, "", next || window.location.pathname);
    }, [view, filters]);

    return { view, filters, streamId, setView, setFilters, openStream, closeStream };
}
