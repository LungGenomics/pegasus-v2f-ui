// Sitewide display settings: theme (light/dark/auto → pegasus / pegasus-dark)
// and root font size. Applied to <html> (data-theme + font-size) and persisted
// in localStorage. Auto follows the OS color-scheme.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "auto";
export type FontSize = "sm" | "md" | "lg";

interface SettingsContextType {
  theme: Theme;
  fontSize: FontSize;
  setTheme: (t: Theme) => void;
  setFontSize: (s: FontSize) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const THEME_KEY = "pegasus-v2f.theme";
const FONT_SIZE_KEY = "pegasus-v2f.font-size";

const fontSizePx: Record<FontSize, string> = {
  sm: "14px",
  md: "16px",
  lg: "18px",
};

function resolveThemeName(theme: Theme): "pegasus" | "pegasus-dark" {
  if (theme === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "pegasus-dark"
      : "pegasus";
  }
  return theme === "dark" ? "pegasus-dark" : "pegasus";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", resolveThemeName(theme));
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme | null) ?? "auto",
  );
  const [fontSize, setFontSizeState] = useState<FontSize>(
    () => (localStorage.getItem(FONT_SIZE_KEY) as FontSize | null) ?? "md",
  );
  const fontMounted = useRef(false);

  useEffect(() => {
    applyTheme(theme);
    if (theme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("auto");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  useEffect(() => {
    // Preserve scroll position from the bottom when resizing rem-based layout.
    const initial = !fontMounted.current;
    fontMounted.current = true;
    if (initial) {
      document.documentElement.style.fontSize = fontSizePx[fontSize];
      return;
    }
    const fromBottom =
      document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    document.documentElement.style.fontSize = fontSizePx[fontSize];
    window.scrollTo({
      top: document.documentElement.scrollHeight - window.innerHeight - fromBottom,
      behavior: "instant",
    });
  }, [fontSize]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
  };
  const setFontSize = (s: FontSize) => {
    setFontSizeState(s);
    localStorage.setItem(FONT_SIZE_KEY, s);
  };

  return (
    <SettingsContext.Provider value={{ theme, fontSize, setTheme, setFontSize }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
