export type AuthTokenPair = {
  accessToken: string;
  refreshToken: string;
};

export type RefreshedAuthTokenPair = {
  access_token: string;
  refresh_token: string;
};

export function tokensRotatedByAnotherTab(
  stored: AuthTokenPair | null,
  attemptedRefreshToken: string,
): RefreshedAuthTokenPair | null {
  if (!stored || stored.refreshToken === attemptedRefreshToken) return null;
  return {
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
  };
}

/**
 * Whether a refresh launched for `attemptedRefreshToken` still owns `stored`.
 *
 * The in-memory generation counter only guards work inside a single tab. Across
 * tabs the authoritative signal is the shared storage itself: a refresh started
 * for token T is only still current for a store if that store still holds T. If
 * an account switch (B logs in) or another tab's rotation replaced it, the store
 * belongs to a newer identity and this refresh's result — whether a late success
 * or a 401 — must not write to or clear it (W6, cross-tab). A missing record is
 * treated as no-longer-current so a late result never resurrects a cleared login.
 */
export function refreshTokenStillCurrent(
  stored: AuthTokenPair | null,
  attemptedRefreshToken: string,
): boolean {
  return stored !== null && stored.refreshToken === attemptedRefreshToken;
}

/**
 * How a completed (or about-to-start) refresh relates to whatever now occupies
 * its store. Every refresh continuation must branch on this before writing,
 * clearing, or adopting tokens (W6).
 *
 * - `current`  — the store still holds the exact token we refreshed for. Persist
 *                our freshly issued pair; a genuine 401 here is a real expiry.
 * - `rotated`  — the store holds a *different* pair for the **same account**
 *                (another tab won the refresh race). Adopt it and safely retry
 *                the original request — it is still that account's operation.
 * - `replaced` — the store holds a **different account** (B logged in). The
 *                pending operation belongs to A and must NOT be replayed under
 *                B's credentials, nor may B's tokens be overwritten. Terminal.
 * - `cleared`  — the store is empty (logout). A late result must never recreate
 *                the credentials. Terminal.
 */
export type RefreshOwnership = "current" | "rotated" | "replaced" | "cleared";

export function classifyRefreshOwnership(params: {
  stored: AuthTokenPair | null;
  attemptedRefreshToken: string;
  storedIdentity: string | null;
  attemptedIdentity: string | null;
}): RefreshOwnership {
  const { stored, attemptedRefreshToken, storedIdentity, attemptedIdentity } = params;
  if (stored === null) return "cleared";
  if (stored.refreshToken === attemptedRefreshToken) return "current";
  // A different token now occupies the store. Only a known, matching identity
  // proves it is the same account rotating its pair; anything else (a different
  // identity, or an identity we cannot establish) is treated as a replacement
  // so an obsolete operation is never handed a different account's authority.
  if (
    storedIdentity !== null &&
    attemptedIdentity !== null &&
    storedIdentity === attemptedIdentity
  ) {
    return "rotated";
  }
  return "replaced";
}
