import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  AppearanceStore,
  DEFAULT_APPEARANCE,
} from "../../shared/appearance-store";

export function useAppearance(scope: string | null | undefined) {
  const store = useMemo(
    () =>
      scope
        ? new AppearanceStore(scope, {
            read: () => window.khaliduo!.getAppearance(scope),
            write: (patch) => window.khaliduo!.setAppearance(scope, patch),
          })
        : null,
    [scope],
  );
  useEffect(() => store?.start(), [store]);
  const appearance = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.snapshot ?? (() => DEFAULT_APPEARANCE),
    () => DEFAULT_APPEARANCE,
  );
  return { appearance, updateAppearance: store?.update };
}
