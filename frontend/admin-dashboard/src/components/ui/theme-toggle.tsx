import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";
const THEME_EVENT = "khaliduo-theme-change";
const THEME_STORAGE_KEY = "khaliduo-theme-v2";
const LEGACY_THEME_STORAGE_KEY = "khaliduo-theme";
const LIGHT_DEFAULT_RESET_KEY = "khaliduo-light-default-applied";

function preferredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  if (window.localStorage.getItem(LIGHT_DEFAULT_RESET_KEY) !== "1") {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.setItem(LIGHT_DEFAULT_RESET_KEY, "1");
    return "light";
  }
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initial = preferredTheme();
    setTheme(initial);
    applyTheme(initial);
    const syncTheme = (event: Event) => setTheme((event as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_EVENT, syncTheme);
    return () => window.removeEventListener(THEME_EVENT, syncTheme);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
  }

  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-border bg-card text-muted-foreground transition hover:border-[#e5185d]/50 hover:text-[#e5185d]",
        className,
      )}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
