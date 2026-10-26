import type { ComponentProps } from "react";

export function TrackerIcon({
  className = "",
  ...props
}: ComponentProps<"svg">) {
  const name = className.match(/ri-[\w-]+/)?.[0] ?? "";
  const path = /heart-pulse/.test(name)
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
                                          : "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M12 7v5l3 2";
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
