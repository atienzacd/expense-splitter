import { useEffect, useState } from "react";

/**
 * Light, dark, or "system" (follow the device). The choice is saved in
 * localStorage; public/theme.js applies it before the first paint.
 */
export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system"; // storage blocked, e.g. some private browsing modes
  }
}

function storeTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice still applies for this visit.
  }
}

export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;

    // In system mode, follow the device when it switches (e.g. at sunset).
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (next: Theme) => {
    storeTheme(next);
    setThemeState(next);
  };
  return [theme, setTheme];
}
