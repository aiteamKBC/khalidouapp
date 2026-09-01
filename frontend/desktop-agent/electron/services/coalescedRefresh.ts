export function createCoalescedRefresh(
  refreshOnce: () => Promise<void>,
): () => Promise<void> {
  let activeRefresh: Promise<void> | null = null;
  let trailingRefreshRequested = false;

  return () => {
    trailingRefreshRequested = true;
    if (!activeRefresh) {
      activeRefresh = (async () => {
        do {
          trailingRefreshRequested = false;
          await refreshOnce();
        } while (trailingRefreshRequested);
      })().finally(() => {
        activeRefresh = null;
      });
    }
    return activeRefresh;
  };
}
