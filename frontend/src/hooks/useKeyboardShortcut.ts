import { useEffect } from "react";
export function useKeyboardShortcut(key: string, handler: () => void) {
  useEffect(() => {
    const cb = (e: KeyboardEvent) => { if (e.key === key && !e.ctrlKey && !e.metaKey) { e.preventDefault(); handler(); } };
    window.addEventListener("keydown", cb);
    return () => window.removeEventListener("keydown", cb);
  }, [key, handler]);
}
