import { useEffect, useMemo, useSyncExternalStore } from "react";
import { apiFetch } from "@/api/client";
import { jwtSubjectScopeKey } from "@/lib/private-query-scope";
import { AppearanceStore, DEFAULT_APPEARANCE } from "../../../../shared/appearance-store";

export function useAppearance(token: string) {
  const scope = jwtSubjectScopeKey(token);
  const store = useMemo(
    () =>
      new AppearanceStore(scope, {
        read: () => apiFetch("/employee-auth/appearance", {}, token),
        write: (patch) =>
          apiFetch(
            "/employee-auth/appearance",
            { method: "PATCH", body: JSON.stringify(patch) },
            token,
          ),
      }),
    [scope, token],
  );
  useEffect(() => store.start(), [store]);
  const appearance = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => DEFAULT_APPEARANCE,
  );
  return { appearance, updateAppearance: store.update };
}
