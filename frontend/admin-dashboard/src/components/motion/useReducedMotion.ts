import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

// Start with static, readable content during SSR and hydration.
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => true,
  );
}
