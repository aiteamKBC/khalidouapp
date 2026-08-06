import assert from "node:assert/strict";
import test from "node:test";

import { resolveApiUrl } from "./api-url.ts";
import { tokensRotatedByAnotherTab } from "./auth-refresh-coordination.ts";
import { jwtSubjectScopeKey, protectedImageQueryKey } from "./private-query-scope.ts";
import { retryTransientRequest } from "./query-retry-policy.ts";

function unsignedToken(payload: Record<string, string>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

test("authenticated API URLs stay inside the configured API root", () => {
  const base = "https://api.example.com/api/v1";
  const origin = "https://dashboard.example.com";

  assert.equal(
    resolveApiUrl(base, "/screenshots/123/file", origin),
    "https://api.example.com/api/v1/screenshots/123/file",
  );
  assert.equal(
    resolveApiUrl(base, "https://api.example.com/api/v1/health", origin),
    "https://api.example.com/api/v1/health",
  );
  assert.equal(resolveApiUrl(base, "https://evil.example/collect", origin), null);
  assert.equal(resolveApiUrl(base, "../outside-api", origin), null);
  assert.equal(resolveApiUrl(base, "blob:https://evil.example/id", origin), null);
});

test("private image cache keys are tenant scoped without containing bearer tokens", () => {
  const firstToken = unsignedToken({ company_id: "company-a", sub: "employee-a" });
  const secondToken = unsignedToken({ company_id: "company-b", sub: "employee-a" });
  const firstKey = protectedImageQueryKey("/screenshots/shot/file", firstToken);
  const secondKey = protectedImageQueryKey("/screenshots/shot/file", secondToken);

  assert.equal(jwtSubjectScopeKey(firstToken), "company-a:employee-a");
  assert.notDeepEqual(firstKey, secondKey);
  assert.equal(JSON.stringify(firstKey).includes(firstToken), false);
});

test("query retries are bounded and skip client/auth/cancellation failures", () => {
  for (const status of [400, 401, 403, 404]) {
    assert.equal(retryTransientRequest(0, { status }), false);
  }
  assert.equal(retryTransientRequest(0, { name: "AbortError" }), false);
  assert.equal(retryTransientRequest(0, { status: 500 }), true);
  assert.equal(retryTransientRequest(1, { status: 503 }), true);
  assert.equal(retryTransientRequest(2, { status: 503 }), false);
});

test("a tab that loses a refresh race adopts the token pair written by the winning tab", () => {
  assert.deepEqual(
    tokensRotatedByAnotherTab(
      { accessToken: "new-access", refreshToken: "new-refresh" },
      "old-refresh",
    ),
    { access_token: "new-access", refresh_token: "new-refresh" },
  );
  assert.equal(
    tokensRotatedByAnotherTab(
      { accessToken: "old-access", refreshToken: "old-refresh" },
      "old-refresh",
    ),
    null,
  );
});
