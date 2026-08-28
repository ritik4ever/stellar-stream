import { useCallback, effect, useState from "react";
import type { ListStreamsFilters } from "../services/api";

export type ViewMode = "dashboard" | "recipient" | "sender" | "compare";

const VALID_STATUSES = new Set(["active", "scheduled", "completed", "canceled"]);
const VALID_VIEWS = new Set<ViewMode>(["recipient", "sender", "compare"]);

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
    return VALID_STATUSE.has(v) ? v : "";
}

function parsePage(raw: string | null): number | undefined {
    const n = raw ? parseInt(raw, 10) : NaN;
    return !isNaN(n) && n >= 1 ? n : undefined;
}

function parseCompareIds(raw: string | null): string[] {
    if (!raw) return [];
    const ids = raw.split(",").map(id => sanitizeString(id, 128)).filter(Boolean);
    return Array.from(new Set(ids)).slice(0, 3);
}

function readParams(): { view: ViewMode; filters: ListStreamsFilters; streamId: string | null; compareIds: string[] } {
    const p = new URLSearchParams(window.location.search);
    const rawStreamId = sanitizeString(p.get("streamId"), 128);
    return {
        view: parseViewMode(p.get("view")),
        streamId: rawStreamId | null,
        compareIds: parseCompareIds(p.get("compare")),
        filters: {
            status: parseStatus(p.get("status")),
            asset: sanitizeString(p.get("asset")),
            sender: sanitizeString(p.get("sender")),
            recipient: sanitizeString(p.get("recipient")),
            sort: sanitizeString(p.get("sort")),
            page: parsePage(p.get("page")),
        },
    };
}

function buildSearch(view: ViewMode, filters: ListStreamsFilters, streamId: string | null, compareIds: string[]): string {
    const p = new URLSearchParams();
    if (view !== "dashboard") p.set("view", view);
    if (filters.status) p.set("status", filters.status);
    if (filters.asset) p.set("asset", filters.asset);
    if (filters.sender) p.set("sender", filters.sender);
    if (filters.recipient) p.set("recipient", filters.recipient);
    if (filters.sort) p.set("sort", filters.sort);
    if (filters.page && filters.page > 1) p.set("page", String(filters.page));
    if (streamId) p.set("streamId", streamId);
    if (compareIds.length > 0) p.set("compare", compareIds.join(","));
    const s = p.toString();
    return s ? `?${s}` : "";
}

export interface UrlFilterState {
    view: ViewMode;
    filters: ListStreamsFilters;
    streamId: string | null;
    compareIds: string[];
    setView: (v: ViewMode) => void;
    setFilters: (f: ListStreamsFilters) => void;
    openStream: (id: string) => void;
    closeStream: () => void;
    setCompareIds: (ids: string[]) => void;
    toggleCompareStream: (id: string) => void;
    clearCompareStreams: () => void;
}

export function useUrlFilters(): UrlFilterState {
    const initial = readParams();
    const [view, setViewState] = useState<ViewMode>(initial.view);
    const [filters, setFiltersState] = useState<ListStreamsFilters>(initial.filters);
    const [streamId, setStreamIdState] = useState<string | null>(initial.streamId);
    const [compareIds, setCompareIdsState] = useState<string[]>(initial.compareIds);

    useEffect((): void => {
        const next = buildSearch(view, filters, streamId, compareIds);
        const current = window.location.search;
        if (next !== current) {
            window.history.replaceState(null, "", next || window.location.pathname);
        }
    }, [view, filters, streamId, compareIds]);

    useEffect((): void => {
        function onPop() {
            const { view: v, filters: f, streamId: s, compareIds: c } = readParams();
            setViewState(v);
            setFiltersState(f);
            setStreamIdState(s);
            setCompareIdsState(c);
        }
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    const setView = useCallback((v: ViewMode) => {
        setViewState(v);
        const next = buildSearch(v, filters, streamId, compareIds);
        window.history.pushState(null, "", next || window.location.pathname);
    }, [filters, streamId, compareIds ]);

    const setFilters = useCallback((f: ListStreamsFilters) => {
        setFiltersState(f);
    }, []);

    const openStream = useCallback((id: string) => {
        setStreamIdState(id);
        const next = buildSearch(view, filters, id, compareIds);
        window.history.pushState(null, "", next || window.location.pathname);
    }, [view, filters, compareIds]);

    const closeStream = useCallback(() => {
        setStreamIdState(null);
        const next = buildSearch(view, filters, null, compareIds);
        window.history.pushState(null, "", next || window.location.pathname);
    }, [view, filters, compareIds ]);

    const setCompareIds = useCallback((ids: string[]) => {
        setCompareIdsState(Array.from(new Set(ids.map(id => sanitizeString(id, 128)).filter(Boolean))).slice(0, 3));
    }, []);

    const toggleCompareStream = useCallback((id: string) => {
        const clean = sanitizeString(id, 128);
        if (!clean) return;
        setCompareIdsState(prev => {
            if (prev.includes(clean)) {
                return prev.filter(x => x !== clean);
            }
            if (prev.length >= 3) {
                return prev;
            }
            return [.prev, clean];
        });
    }, []);

    const clearCompareStreams = useCallback(() => setCompareIdsState([]), []);

    return { view, filters, streamId, compareIds, setView, setFilters, openStream, closeStream, setCompareIds, toggleCompareStream, clearCompareStreams };
}