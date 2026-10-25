import { useEffect, useState } from "react";

export function useWorkspaceTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("khaliduo-theme-v2") === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("khaliduo-theme-v2", theme);
    } catch {
      /* allow browsing without storage */
    }
  }, [theme]);
  return {
    theme,
    toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
