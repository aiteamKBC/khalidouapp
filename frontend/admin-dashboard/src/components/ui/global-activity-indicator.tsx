import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

export function GlobalActivityIndicator() {
  const routeIsLoading = useRouterState({
    select: (state) => state.isLoading || state.isTransitioning,
  });
  const foregroundFetches = useIsFetching({
    predicate: (query) =>
      query.state.fetchStatus === "fetching" &&
      query.state.data === undefined &&
      query.meta?.suppressGlobalLoading !== true,
  });
  const mutations = useIsMutating();
  const isBusy = routeIsLoading || foregroundFetches > 0 || mutations > 0;
  const message =
    mutations > 0 ? "Saving changes..." : routeIsLoading ? "Opening page..." : "Loading data...";

  if (!isBusy) return null;

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-primary/15"
        aria-hidden="true"
      >
        <span className="global-loading-bar block h-full w-2/5 rounded-full bg-gradient-to-r from-[#e5185d] via-fuchsia-500 to-violet-500 shadow-[0_0_12px_rgba(229,24,93,0.75)]" />
      </div>
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed left-1/2 top-4 z-[100] -translate-x-1/2"
      >
        <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-card/95 px-4 py-2 text-sm font-bold text-foreground shadow-xl backdrop-blur">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {message}
        </div>
      </div>
    </>
  );
}
