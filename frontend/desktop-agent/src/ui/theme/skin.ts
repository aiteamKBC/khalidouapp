import { useCallback, useEffect, useState } from "react";

/**
 * Palette ("skin") for the reskinned shell. Light/dark stays the app's
 * existing `theme` state; this only adds which palette is used. Both are
 * painted on <html> because skins.css keys off html[data-skin] and the
 * Tailwind dark variant off html.dark.
 */
export type Skin = "orbit" | "ember" | "forest";
export type Mode = "light" | "dark";

export type SkinMeta = {
  key: Skin;
  label: string;
  blurb: string;
  swatch: string[];
  swatchDark: string[];
};

export const SKINS: SkinMeta[] = [
  {
    key: "orbit",
    label: "Orbit",
    blurb: "Lavender & indigo",
    swatch: ["#171336", "#9b87ff", "#7c5cff"],
    swatchDark: ["#0d0b21", "#b3a2ff", "#8f74ff"],
  },
  {
    key: "ember",
    label: "Ember",
    blurb: "Cream & clay",
    swatch: ["#fdf7f0", "#df7a2c", "#a4441a"],
    swatchDark: ["#17111c", "#f0954a", "#cf6a30"],
  },
  {
    key: "forest",
    label: "Forest",
    blurb: "Mint & emerald",
    swatch: ["#f3faf6", "#17b083", "#0c5c45"],
    swatchDark: ["#06120f", "#34d399", "#17a081"],
  },
];

const SKIN_STORAGE_KEY = "khaliduo-skin";

function isSkin(value: unknown): value is Skin {
  return value === "orbit" || value === "ember" || value === "forest";
}

function initialSkin(): Skin {
  try {
    const saved = window.localStorage.getItem(SKIN_STORAGE_KEY);
    return isSkin(saved) ? saved : "orbit";
  } catch {
    return "orbit";
  }
}

export function skinMeta(skin: Skin): SkinMeta {
  return SKINS.find((item) => item.key === skin) ?? SKINS[0];
}

export function useSkin(mode: Mode) {
  const [skin, setSkinState] = useState<Skin>(initialSkin);

  useEffect(() => {
    const root = document.documentElement;
    // skins.css still names the orbit palette "violet".
    root.dataset.skin = skin === "orbit" ? "violet" : skin;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
  }, [skin, mode]);

  const setSkin = useCallback((next: Skin) => {
    setSkinState(next);
    try {
      window.localStorage.setItem(SKIN_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable; the choice still applies this session.
    }
  }, []);

  return { skin, setSkin };
}
