// How to react when restoring a saved session (`GET /auth/me` at startup) fails.
//
// Only an authenticated-but-rejected response (401/403) proves the saved login
// is invalid or revoked and should be cleared. A network failure, timeout, or
// 5xx is transient — deleting the saved tokens there would turn a brief outage
// into a forced sign-in (W7). Transient failures keep the tokens so a retry can
// recover without the user re-entering credentials.
export type RestoreFailureKind = "revoked" | "transient";

export function classifyRestoreFailure(error: unknown): RestoreFailureKind {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status === "number" && (status === 401 || status === 403)) {
    return "revoked";
  }
  return "transient";
}

/** Whether a failed session restore should delete the saved credentials. */
export function shouldClearSavedSession(error: unknown): boolean {
  return classifyRestoreFailure(error) === "revoked";
}

/**
 * Whether a failed token-refresh HTTP response should clear the saved session.
 * Only a genuine auth rejection (401/403 — the refresh token is invalid/expired)
 * clears it; a transient server outage (5xx) or a malformed 2xx keeps the tokens
 * so a retry can recover instead of deleting the login on a blip (W7).
 */
export function refreshFailureClears(status: number): boolean {
  return status === 401 || status === 403;
}
