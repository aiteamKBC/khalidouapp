const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);
// Authentication/authorization failures. The token is invalid, expired, or
// revoked — a state that a re-enrollment (identity repair) can fix. These must
// NOT retire queued work; deleting a saved heartbeat on a 401 permanently
// discarded recorded time that signing in again could have delivered.
const AUTH_HTTP_STATUSES = new Set([401, 403]);

/**
 * True when a queued non-media event failed because of authentication, not
 * because its payload was rejected. The caller retains the row and suspends
 * replay until the identity is repaired, instead of hammering a bad token.
 */
export function isAuthPendingEventSyncFailure(
  responseStatus?: number | null,
): boolean {
  return (
    responseStatus !== null &&
    responseStatus !== undefined &&
    AUTH_HTTP_STATUSES.has(responseStatus)
  );
}

/**
 * Missing responses, server errors, throttling, and authentication failures can
 * all recover. Only a definitive client rejection of the payload itself (e.g.
 * 400 bad request, 404 unknown session, 409 conflict, 410 gone, 422 invalid)
 * should retire a queued non-media event.
 */
export function isPermanentPendingEventSyncFailure(
  responseStatus?: number | null,
) {
  return (
    responseStatus !== null &&
    responseStatus !== undefined &&
    responseStatus >= 400 &&
    responseStatus < 500 &&
    !RETRYABLE_HTTP_STATUSES.has(responseStatus) &&
    !AUTH_HTTP_STATUSES.has(responseStatus)
  );
}
