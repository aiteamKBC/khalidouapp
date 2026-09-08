// After posting an explicit tracking-state transition (e.g. idle_ended ->
// "active" when the user clicks "Continue working"), the agent syncs its runtime
// from the session snapshot the API returns. That snapshot can still echo the
// PRE-transition status because the write is eventually consistent or a
// concurrent heartbeat raced the event. If the stale echo is allowed to win, the
// just-resumed session flips back to "idle", the 250ms monitor re-shows the
// idle-return prompt, and "Continue working" loops forever without resuming.
//
// This helper decides which status is authoritative after a sync, so the rule is
// unit-testable in isolation.

export function reconcileTrackingStatusAfterSync<T extends string>(params: {
  // The status we just posted to the server for this transition.
  postedStatus: T;
  // runtimeStatus.trackingStatus captured right before syncRuntimeFromSession
  // ran (i.e. after we optimistically set postedStatus locally).
  localStatusBeforeSync: T;
  // Whether the server's returned session is ended/offline.
  sessionEndedServerSide: boolean;
}): T | null {
  // The server ended the session — respect that; leave whatever the sync applied.
  if (params.sessionEndedServerSide) {
    return null;
  }
  // A concurrent local transition happened during the network round-trip (e.g.
  // the screen locked mid-request): that newer local intent wins.
  if (params.localStatusBeforeSync !== params.postedStatus) {
    return params.localStatusBeforeSync;
  }
  // No concurrent change: our posted transition wins over a stale server echo.
  return params.postedStatus;
}
