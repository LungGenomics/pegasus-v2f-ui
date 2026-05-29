// Sitewide footer: font-size + theme (light/auto/dark) controls and a link to
// the GitHub repo. Display settings come from SettingsContext.

import {
  AArrowDown,
  ALargeSmall,
  AArrowUp,
  Sun,
  SunMoon,
  Moon,
  Github,
} from "lucide-react";
import {
  useSettings,
  type FontSize,
  type Theme,
} from "../../contexts/settings-context";

const FONT_OPTIONS: { value: FontSize; icon: typeof AArrowDown; title: string }[] = [
  { value: "sm", icon: AArrowDown, title: "Small text" },
  { value: "md", icon: ALargeSmall, title: "Medium text" },
  { value: "lg", icon: AArrowUp, title: "Large text" },
];

const THEME_OPTIONS: { value: Theme; icon: typeof Sun; title: string }[] = [
  { value: "light", icon: Sun, title: "Light" },
  { value: "auto", icon: SunMoon, title: "Auto" },
  { value: "dark", icon: Moon, title: "Dark" },
];

const REPO_URL = "https://github.com/LungGenomics/pegasus-v2f-ui";

export function Footer() {
  const { theme, fontSize, setTheme, setFontSize } = useSettings();

  return (
    <footer className="shrink-0 border-t border-base-300 bg-base-100 px-6 py-4 flex items-center gap-4 text-xs text-base-content/50">
      <span className="font-mono">pegasus.v2f</span>

      <div className="ml-auto flex items-center gap-4">
        {/* Font size */}
        <div className="inline-flex bg-base-200 rounded-md p-0.5">
          {FONT_OPTIONS.map(({ value, icon: Icon, title }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFontSize(value)}
              title={title}
              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                fontSize === value
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/50 hover:text-base-content"
              }`}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>

        {/* Theme */}
        <div className="inline-flex bg-base-200 rounded-md p-0.5">
          {THEME_OPTIONS.map(({ value, icon: Icon, title }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              title={title}
              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                theme === value
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/50 hover:text-base-content"
              }`}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub repository"
          className="text-base-content/50 hover:text-base-content"
        >
          <Github className="size-4" />
        </a>
      </div>
    </footer>
  );
}
