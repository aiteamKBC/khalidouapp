// Readdy V214 (15260569): dashboard palette and mode are one theme choice.
export type DashboardSkin = "orbit" | "ember" | "forest";
export type WorkspaceTheme = "light" | "dark";

const PALETTES: {
  skin: DashboardSkin;
  label: string;
  blurb: string;
  light: string[];
  dark: string[];
}[] = [
  {
    skin: "orbit",
    label: "Orbit",
    blurb: "Plum & magenta",
    light: ["#f5f2fa", "#412c6f", "#9d145e"],
    dark: ["#120f1c", "#d9cdf7", "#f472b6"],
  },
  {
    skin: "ember",
    label: "Ember",
    blurb: "Cream & clay",
    light: ["#fdf7f0", "#c1662f", "#a4441a"],
    dark: ["#17111c", "#f4c8a6", "#f0954a"],
  },
  {
    skin: "forest",
    label: "Forest",
    blurb: "Mint & emerald",
    light: ["#f3faf6", "#17876a", "#0c5c45"],
    dark: ["#06120f", "#9ff0d1", "#34d399"],
  },
];

export const DASHBOARD_THEMES = PALETTES.flatMap((palette) =>
  (["light", "dark"] as const).map((mode) => ({
    id: `${palette.skin}-${mode}`,
    skin: palette.skin,
    mode,
    label: `${palette.label} ${mode === "light" ? "Light" : "Dark"}`,
    blurb: palette.blurb,
    swatch: palette[mode],
  })),
);

export function isDashboardSkin(value: string | null): value is DashboardSkin {
  return value === "orbit" || value === "ember" || value === "forest";
}
