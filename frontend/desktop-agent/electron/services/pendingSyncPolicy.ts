const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);

/**
 * Missing responses, server errors, and throttling can recover. Only a
 * definitive client rejection should retire a queued non-media event.
 */
export function isPermanentPendingEventSyncFailure(
  responseStatus?: number | null,
) {
  return (
    responseStatus !== null &&
    responseStatus !== undefined &&
    responseStatus >= 400 &&
    responseStatus < 500 &&
    !RETRYABLE_HTTP_STATUSES.has(responseStatus)
  );
}
