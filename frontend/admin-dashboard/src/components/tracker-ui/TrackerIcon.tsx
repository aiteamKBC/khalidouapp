import type { ComponentProps } from "react";

export function TrackerIcon({ className = "", ...props }: ComponentProps<"svg">) {
  const name = className.match(/ri-[\w-]+/)?.[0] ?? "";
  const icons: Record<string, string> = {
    "ri-refresh-line": "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 5M18 18a8 8 0 0 1-13-5",
    "ri-palette-line":
      "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h5a3 3 0 0 0 3-3c0-4-4-7-9-7M7 9h.01M10 6h.01M15 6h.01M5 13h.01",
    "ri-settings-line":
      "m10 3-1 3-3 1-3 3 2 2-1 3 3 3 3-1 2 2 3-1 1-3 3-1 1-3-2-2 1-3-3-3-3 1-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    "ri-cup-line": "M4 5h13v10a5 5 0 0 1-10 0V5M17 6h3v5h-3M4 21h14",
    "ri-hourglass-line": "M6 3h12M6 21h12M7 3v5l10 8v5M17 3v5L7 16v5",
    "ri-flag-line": "M5 22V3c5-4 8 4 14 0v11c-6 4-9-4-14 0",
    "ri-quill-pen-line": "M4 20 18 6M4 20l5-1L21 7l-4-4L5 15zM12 8l4 4",
    "ri-focus-line":
      "M12 2v4M12 18v4M2 12h4M18 12h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    "ri-focus-3-line":
      "M12 2v4M12 18v4M2 12h4M18 12h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    "ri-stop-circle-line": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M9 9h6v6H9z",
    "ri-login-box-line": "M9 4H3v16h6M13 7l5 5-5 5M7 12h14",
    "ri-inbox-line": "M3 4h18v16H3zM3 13h6l2 3h2l2-3h6",
    "ri-calendar-line": "M4 5h16v16H4zM8 2v6M16 2v6M4 11h16",
  };
  const path =
    icons[name] ??
    (/heart-pulse/.test(name)
      ? "M20 13c3-5-3-10-8-5-5-5-11 0-8 5l8 8 8-8M3 12h5l2-3 4 6 2-3h5"
      : /calendar-check/.test(name)
        ? "M5 5h14v16H5zM8 3v4M16 3v4M5 10h14M9 15l2 2 4-4"
        : /add-circle/.test(name)
          ? "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M8 12h8M12 8v8"
          : /forbid/.test(name)
            ? "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M6 6l12 12"
            : /play-circle/.test(name)
              ? "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M10 8l6 4-6 4z"
              : /pause-circle/.test(name)
                ? "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M10 8v8M14 8v8"
                : /arrow-down/.test(name)
                  ? "m6 9 6 6 6-6"
                  : /arrow-up/.test(name)
                    ? "m6 15 6-6 6 6"
                    : /check/.test(name)
                      ? "m5 12 4 4L19 6"
                      : /close/.test(name)
                        ? "m6 6 12 12M6 18 18 6"
                        : /image/.test(name)
                          ? "M3 3h18v18H3zM3 16l5-5 4 4 3-3 6 6M16 7h.01"
                          : /task/.test(name)
                            ? "M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01"
                            : /sun/.test(name)
                              ? "M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0"
                              : /moon/.test(name)
                                ? "M20 15a9 9 0 0 1-11-11A9 9 0 1 0 20 15"
                                : /bar-chart|progress/.test(name)
                                  ? "M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"
                                  : /shapes/.test(name)
                                    ? "M12 2 5 11h14zM3 15h6v6H3zM21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0"
                                    : /pause/.test(name)
                                      ? "M8 5v14M16 5v14"
                                      : /play/.test(name)
                                        ? "m8 5 11 7-11 7z"
                                        : /arrow-left/.test(name)
                                          ? "M20 12H4m6-6-6 6 6 6"
                                          : /arrow-right/.test(name)
                                            ? "M4 12h16m-6-6 6 6-6 6"
                                            : "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M12 7v5l3 2");
  return (
    <svg
      {...props}
      className={className.replace(/ri-[\w-]+/, "")}
      style={{ width: "1em", height: "1em", ...props.style }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
