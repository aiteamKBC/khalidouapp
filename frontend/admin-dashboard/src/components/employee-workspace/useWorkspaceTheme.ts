import { useEffect, useState } from "react";

export function useWorkspaceTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("khaliduo-theme-v2") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
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
    setTheme,
    toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
