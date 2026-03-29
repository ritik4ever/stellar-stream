/**
 * useFocusTrap.ts
 *
 * Traps keyboard focus inside a given container element while it is active.
 * When the user reaches the last focusable element and presses Tab, focus
 * wraps to the first; Shift+Tab from the first wraps to the last.
 *
 * Usage:
 *   const panelRef = useFocusTrap<HTMLDivElement>(isOpen);
 *   <div ref={panelRef} ...>
 */

import { useEffect, useRef } from "react";

/** CSS selector covering all standard focusable elements */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Returns a ref to attach to the modal panel container.
 * Focus is trapped inside the container whenever `active` is true.
 *
 * @param active  Whether the trap is currently active (modal is open).
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    /** Collect all currently focusable children. Re-queried on each tab so
     *  dynamically added/removed elements (e.g. error messages) are included. */
    function getFocusable(): HTMLElement[] {
      return Array.from(
        container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.closest("[inert]"));
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        // Shift+Tab: if focus is on (or outside) the first element, wrap to last
        if (!active || active === first || !container!.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if focus is on (or outside) the last element, wrap to first
        if (!active || active === last || !container!.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  return containerRef;
}
