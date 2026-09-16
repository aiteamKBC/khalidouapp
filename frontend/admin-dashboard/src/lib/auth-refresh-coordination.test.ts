import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRefreshOwnership,
  refreshTokenStillCurrent,
  tokensRotatedByAnotherTab,
} from "./auth-refresh-coordination.ts";

const A = { accessToken: "access-A", refreshToken: "refresh-A" };
const A_ROTATED = { accessToken: "access-A2", refreshToken: "refresh-A2" };
const B = { accessToken: "access-B", refreshToken: "refresh-B" };

// The generation counter only guards work inside one tab. Across tabs the
// shared storage is the source of truth: a refresh launched for token T only
// still owns a store if that store still holds T. Both W6 cross-tab defects are
// closed by consulting this before writing a refreshed pair or clearing a login.

test("a refresh still owns its store when the store still holds its token", () => {
  assert.equal(
    refreshTokenStillCurrent(
      { accessToken: "access-A", refreshToken: "refresh-A" },
      "refresh-A",
    ),
    true,
  );
});

test("a refresh no longer owns its store once a newer login replaced the token", () => {
  // Account switch B (or another tab's rotation) wrote a different pair. A late
  // A-success must not overwrite it, and a late A-401 must not clear it (W6).
  assert.equal(
    refreshTokenStillCurrent(
      { accessToken: "access-B", refreshToken: "refresh-B" },
      "refresh-A",
    ),
    false,
  );
});

test("a refresh does not own a store that was already cleared", () => {
  // A logout emptied the store; a late result must never resurrect it (W6).
  assert.equal(refreshTokenStillCurrent(null, "refresh-A"), false);
});

test("supersession and ownership are consistent complements", () => {
  // When the store holds a different token, tokensRotatedByAnotherTab surfaces
  // the newer pair (used on the success path) and ownership is false (used on
  // the clear path) — the two guards agree on who owns the store.
  const newer = { accessToken: "access-B", refreshToken: "refresh-B" };
  assert.notEqual(tokensRotatedByAnotherTab(newer, "refresh-A"), null);
  assert.equal(refreshTokenStillCurrent(newer, "refresh-A"), false);

  const same = { accessToken: "access-A", refreshToken: "refresh-A" };
  assert.equal(tokensRotatedByAnotherTab(same, "refresh-A"), null);
  assert.equal(refreshTokenStillCurrent(same, "refresh-A"), true);
});

// classifyRefreshOwnership is the single decision every refresh continuation
// branches on. Opaque tokens can't reveal identity, so a real signal (the
// signed-in user id) distinguishes same-account rotation from replacement.

test("an unchanged token in the store is classified current", () => {
  assert.equal(
    classifyRefreshOwnership({
      stored: A,
      attemptedRefreshToken: A.refreshToken,
      storedIdentity: "user:a",
      attemptedIdentity: "user:a",
    }),
    "current",
  );
});

test("a different token for the same account is a rotation, not a replacement", () => {
  // Another tab won the refresh race for the same user — safe to adopt/retry.
  assert.equal(
    classifyRefreshOwnership({
      stored: A_ROTATED,
      attemptedRefreshToken: A.refreshToken,
      storedIdentity: "user:a",
      attemptedIdentity: "user:a",
    }),
    "rotated",
  );
});

test("a different account owning the store is a replacement", () => {
  // B logged in while A's refresh was pending. A's operation must not run as B.
  assert.equal(
    classifyRefreshOwnership({
      stored: B,
      attemptedRefreshToken: A.refreshToken,
      storedIdentity: "user:b",
      attemptedIdentity: "user:a",
    }),
    "replaced",
  );
});

test("a different token with unknown identity is treated as replacement (safe default)", () => {
  // Cannot prove same account → never hand the pending operation another pair.
  assert.equal(
    classifyRefreshOwnership({
      stored: B,
      attemptedRefreshToken: A.refreshToken,
      storedIdentity: null,
      attemptedIdentity: "user:a",
    }),
    "replaced",
  );
});

test("an emptied store (logout) is classified cleared, never resurrected", () => {
  assert.equal(
    classifyRefreshOwnership({
      stored: null,
      attemptedRefreshToken: A.refreshToken,
      storedIdentity: null,
      attemptedIdentity: "user:a",
    }),
    "cleared",
  );
});
