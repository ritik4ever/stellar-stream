import type { Theme } from "../hooks/useTheme";

interface DarkModeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

export function DarkModeToggle({ theme, onToggle }: DarkModeToggleProps) {
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="btn-ghost dark-mode-toggle"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span aria-hidden="true">{isDark ? "☀" : "🌙"}</span>
    </button>
  );
}
