import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export type ThemePreference = Theme | "system";

const STORAGE_KEY = "stellar-stream-theme";

function getStoredPreference(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage unavailable (e.g. private browsing with restrictions)
  }
  return null;
}

function getSystemTheme(): Theme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

function getInitialPreference(): ThemePreference {
  return getStoredPreference() ?? "system";
}

function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? getSystemTheme() : preference;
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.style.colorScheme = theme;
}

export function useTheme(): {
  theme: Theme;
  preference: ThemePreference;
  toggleTheme: () => void;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(getInitialPreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme);

  // Track the OS preference so "system" stays in sync with live changes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(media.matches ? "dark" : "light");
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const theme = resolveTheme(preference);

  // Apply class and persist whenever the resolved theme changes.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Persist the user's explicit choice (or "system").
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Ignore write failures (quota exceeded, private mode, etc.)
    }
  }, [preference]);

  const toggleTheme = useCallback(() => {
    setPreferenceState((theme === "dark" ? "light" : "dark") as ThemePreference);
  }, [theme]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
  }, []);

  return { theme, preference, toggleTheme, setPreference };
}
