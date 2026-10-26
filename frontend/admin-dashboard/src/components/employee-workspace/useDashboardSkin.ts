import { useEffect, useState } from "react";
import { isDashboardSkin, type DashboardSkin } from "./dashboard-skins";

const STORAGE_KEY = "khaliduo-dashboard-skin-v1";

export function useDashboardSkin() {
  const [skin, setSkin] = useState<DashboardSkin>("orbit");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isDashboardSkin(saved)) setSkin(saved);
    } catch {
      /* Browsing without storage still supports theme changes. */
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORAGE_KEY, skin);
    } catch {
      /* Optional device preference. */
    }
  }, [skin, restored]);
  return { skin, setSkin };
}
