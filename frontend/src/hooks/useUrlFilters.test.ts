import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUrlFilters } from "./useUrlFilters";

describe("useUrlFilters", () => {
    const URL_PREFIX = "http://localhost";

    beforeEach(() => {
        const url = new URL(URL_PREFIX);
        vi.stubGlobal("location", {
            ...window.location,
            href: url.href,
            search: url.search,
            pathname: url.pathname,
        });
        vi.stubGlobal("history", {
            replaceState: vi.fn((_state, _title, url) => {
                const newUrl = new URL(url, URL_PREFIX);
                window.location.search = newUrl.search;
            }),
            pushState: vi.fn((_state, _title, url) => {
                const newUrl = new URL(url, URL_PREFIX);
                window.location.search = newUrl.search;
            }),
        });
    });

    it("should initialize filter state from URL parameters", () => {
        const url = new URL("http://localhost/?view=recipient&status=active&asset=USDC");
        vi.stubGlobal("location", {
            ...window.location,
            search: url.search,
        });

        const { result } = renderHook(() => useUrlFilters());

        expect(result.current.view).toBe("recipient");
        expect(result.current.filters).toEqual({
            status: "active",
            asset: "USDC",
            sender: "",
            recipient: "",
            sort: "",
            page: 1,
        });
    });

    it("should update URL search parameters when a filter is set", () => {
        const { result } = renderHook(() => useUrlFilters());

        act(() => {
            result.current.setFilters({
                status: "completed",
                asset: "XLM",
                sender: "",
                recipient: "",
                sort: "",
                page: 1,
            });
        });

        expect(window.history.replaceState).toHaveBeenCalled();
        const searchParams = new URLSearchParams(window.location.search);
        expect(searchParams.get("status")).toBe("completed");
        expect(searchParams.get("asset")).toBe("XLM");
    });

    it("should remove parameters from URL when filters are cleared", () => {
        const url = new URL("http://localhost/?status=active&asset=USDC");
        vi.stubGlobal("location", {
            ...window.location,
            search: url.search,
        });

        const { result } = renderHook(() => useUrlFilters());

        act(() => {
            result.current.setFilters({
                status: "",
                asset: "",
                sender: "",
                recipient: "",
                sort: "",
                page: 1,
            });
        });

        const searchParams = new URLSearchParams(window.location.search);
        expect(searchParams.has("status")).toBe(false);
        expect(searchParams.has("asset")).toBe(false);
    });

    it("should handle multiple filters simultaneously", () => {
        const { result } = renderHook(() => useUrlFilters());

        act(() => {
            result.current.setFilters({
                status: "canceled",
                asset: "EURC",
                sender: "G123...",
                recipient: "G456...",
                sort: "amount-desc",
                page: 2,
            });
        });

        const searchParams = new URLSearchParams(window.location.search);
        expect(searchParams.get("status")).toBe("canceled");
        expect(searchParams.get("asset")).toBe("EURC");
        expect(searchParams.get("sender")).toBe("G123...");
        expect(searchParams.get("recipient")).toBe("G456...");
        expect(searchParams.get("sort")).toBe("amount-desc");
        expect(searchParams.get("page")).toBe("2");
    });

    it("should update view mode and push to history", () => {
        const { result } = renderHook(() => useUrlFilters());

        act(() => {
            result.current.setView("sender");
        });

        expect(window.history.pushState).toHaveBeenCalled();
        expect(result.current.view).toBe("sender");
        const searchParams = new URLSearchParams(window.location.search);
        expect(searchParams.get("view")).toBe("sender");
    });

    it("should handle opening and closing streams via URL", () => {
        const { result } = renderHook(() => useUrlFilters());

        act(() => {
            result.current.openStream("stream_99");
        });

        expect(result.current.streamId).toBe("stream_99");
        expect(new URLSearchParams(window.location.search).get("streamId")).toBe("stream_99");

        act(() => {
            result.current.closeStream();
        });

        expect(result.current.streamId).toBe(null);
        expect(new URLSearchParams(window.location.search).has("streamId")).toBe(false);
    });

    it("should parse sort param from URL on init", () => {
        const url = new URL("http://localhost/?sort=amount-desc");
        vi.stubGlobal("location", {
            ...window.location,
            search: url.search,
        });

        const { result } = renderHook(() => useUrlFilters());
        expect(result.current.filters.sort).toBe("amount-desc");
    });

    it("should parse page param from URL on init", () => {
        const url = new URL("http://localhost/?page=3");
        vi.stubGlobal("location", {
            ...window.location,
            search: url.search,
        });

        const { result } = renderHook(() => useUrlFilters());
        expect(result.current.filters.page).toBe(3);
    });

    it("should omit page=1 from URL but keep state", () => {
        const { result } = renderHook(() => useUrlFilters());

        expect(result.current.filters.page).toBe(1);

        act(() => {
            result.current.setFilters({
                status: "active",
                asset: "",
                sender: "",
                recipient: "",
                sort: "",
                page: 1,
            });
        });

        const searchParams = new URLSearchParams(window.location.search);
        expect(searchParams.has("page")).toBe(false);
    });

    it("should persist sort param in URL", () => {
        const { result } = renderHook(() => useUrlFilters());

        act(() => {
            result.current.setFilters({
                status: "",
                asset: "",
                sender: "",
                recipient: "",
                sort: "createdAt-asc",
                page: 1,
            });
        });

        const searchParams = new URLSearchParams(window.location.search);
        expect(searchParams.get("sort")).toBe("createdAt-asc");
    });
});
