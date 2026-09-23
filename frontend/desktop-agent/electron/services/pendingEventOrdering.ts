// Queued events for one work session form a causal chain: manual_pause_started
// must reach the server before manual_pause_ended, which must reach it before
// the session end. The retry queue previously filtered out events still in
// backoff *before* ordering by creation time, so if an earlier pause was backed
// off while a later resume/end was due, the later event was uploaded first —
// delivering Resume before Pause, or End before the state evidence it depends
// on. The delayed predecessor then arrived after the session had closed and was
// silently discarded as immutable.
//
// These helpers restore per-session head-of-line ordering: within a session
// group, no event is deliverable until every earlier event in that group is.
// Independent session groups still progress in parallel.

export function sessionGroupForEndpoint(endpoint: string): string {
  // Group by the session id in `/agent/sessions/{id}/...`. Events that do not
  // target a session are grouped by their raw endpoint, so unrelated endpoints
  // never block one another.
  const match = /\/agent\/sessions\/([^/]+)\//.exec(endpoint);
  if (match) return match[1];
  // A meeting End depends on its Start even though the API uses two endpoint
  // paths. Keep the pair in one causal queue so an offline/backed-off Start can
  // never be overtaken by its End.
  if (endpoint === "/agent/meetings" || endpoint === "/agent/meetings/end") {
    return "/agent/meetings";
  }
  return endpoint;
}

export function orderedDuePendingEvents<
  T extends { endpoint: string; nextAttemptAt: string },
>(
  events: T[], // MUST already be ordered by created_at ascending
  options: { now: number; force?: boolean; limit: number },
): T[] {
  const blockedGroups = new Set<string>();
  const due: T[] = [];
  for (const event of events) {
    if (due.length >= options.limit) break;
    const group = sessionGroupForEndpoint(event.endpoint);
    if (blockedGroups.has(group)) {
      // An earlier event in this session's chain is not deliverable this pass,
      // so this successor must wait for it — even if its own backoff elapsed.
      continue;
    }
    const isDue =
      options.force === true || Date.parse(event.nextAttemptAt) <= options.now;
    if (!isDue) {
      // This event is still backing off; block the whole chain behind it.
      blockedGroups.add(group);
      continue;
    }
    due.push(event);
  }
  return due;
}
