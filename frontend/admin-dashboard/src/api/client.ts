import { resolveApiUrl } from "@/lib/api-url";
import {
  advanceAuthGeneration,
  currentAuthGeneration,
  isAuthGenerationStale,
} from "@/lib/auth-lifecycle";
import {
  classifyRefreshOwnership,
  type RefreshOwnership,
} from "@/lib/auth-refresh-coordination";
import { refreshFailureClears } from "@/lib/auth-restore-policy";
import { jwtSubjectScopeKey } from "@/lib/private-query-scope";
export { retryTransientRequest } from "@/lib/query-retry-policy";
export { currentAuthGeneration, isAuthGenerationStale } from "@/lib/auth-lifecycle";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1"
).replace(/\/$/, "");

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

type FastApiValidationError = {
  detail?: Array<{
    loc?: Array<string | number>;
    msg?: string;
  }>;
};

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type PersistedAuth = {
  accessToken: string;
  refreshToken: string;
};

type PersistedAuthLocation = {
  auth: PersistedAuth;
  storage: Storage;
  // The account identity captured at the moment this location was read (request
  // start). Bound here so a cross-tab account replacement that lands *before*
  // the original request's 401 cannot be mistaken for a same-account rotation
  // when the refresh later classifies the store (W6).
  identity: string | null;
};

type RefreshedTokens = {
  access_token: string;
  refresh_token: string;
};

const AUTH_STORAGE_KEY = "khaliduo.auth";
const AUTH_REFRESHED_EVENT = "khaliduo:auth-refreshed";
const AUTH_EXPIRED_EVENT = "khaliduo:auth-expired";
const AUTH_REFRESH_LOCK = "khaliduo.auth.refresh";

// The shared single-flight refresh is tagged with the identity that started it.
// A pooled refresh may only be joined by requests from the SAME account, so a
// refresh started by B never hands its fresh tokens to A's obsolete request (W6).
let refreshInFlight: { identity: string | null; promise: Promise<RefreshedTokens> } | null = null;
const inFlightGetRequests = new Map<string, Promise<unknown>>();
let runtimeAuth: PersistedAuthLocation | null = null;
const MAX_CONCURRENT_IMAGE_REQUESTS = 4;
let activeImageRequests = 0;

type QueuedImageRequest = {
  run: () => void;
  signal?: AbortSignal;
  reject: (reason?: unknown) => void;
  abort: () => void;
};

const queuedImageRequests: QueuedImageRequest[] = [];

function abortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The image request was cancelled.", "AbortError");
}

function drainImageQueue() {
  while (activeImageRequests < MAX_CONCURRENT_IMAGE_REQUESTS && queuedImageRequests.length > 0) {
    const request = queuedImageRequests.shift();
    if (!request) return;
    request.signal?.removeEventListener("abort", request.abort);
    if (request.signal?.aborted) {
      request.reject(abortError(request.signal));
      continue;
    }
    activeImageRequests += 1;
    request.run();
  }
}

export function rememberAuthTokens(auth: PersistedAuth, storage: Storage) {
  // The in-memory fallback has no persisted `user` record to read, so anchor its
  // identity on the access token's JWT subject (company:sub). Real logins/restores
  // additionally refresh this via readAuth, which prefers the persisted user id.
  runtimeAuth = { auth, storage, identity: jwtSubjectScopeKey(auth.accessToken, "") || null };
}

export function forgetAuthTokens() {
  runtimeAuth = null;
  // Every path that forgets tokens is a logout/session-clear. Advance the auth
  // generation so any in-flight refresh or /auth/me restore started under the
  // old identity refuses to commit its result afterwards (W6).
  advanceAuthGeneration();
}

function requestDedupeKey(
  responseKind: "data" | "meta",
  path: string,
  init: RequestInit,
  token?: string,
) {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" || init.body || init.signal) return null;

  const headerKey = [...new Headers(init.headers).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
  return `${responseKind}\u0000${token ?? "anonymous"}\u0000${path}\u0000${headerKey}`;
}

async function coalesceInFlight<T>(key: string | null, execute: () => Promise<T>): Promise<T> {
  if (!key) return execute();

  const existing = inFlightGetRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = execute();
  inFlightGetRequests.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightGetRequests.get(key) === pending) {
      inFlightGetRequests.delete(key);
    }
  }
}

function accessTokenExpiresAt(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as {
      exp?: number;
    };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.reason === "timeout") {
      throw new ApiClientError(
        "The server took too long to respond. Please try again.",
        "NETWORK_TIMEOUT",
        0,
      );
    }
    if (init.signal?.aborted && init.signal.reason instanceof Error) {
      throw init.signal.reason;
    }
    if (error instanceof TypeError) {
      throw new ApiClientError(
        "The server could not be reached. Check your connection and try again.",
        "NETWORK_ERROR",
        0,
      );
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function readAuth(): PersistedAuthLocation | null {
  if (typeof window === "undefined") return null;

  for (const storage of [localStorage, sessionStorage]) {
    const raw = storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) continue;
    try {
      const auth = JSON.parse(raw) as PersistedAuth;
      if (auth.accessToken && auth.refreshToken) {
        rememberAuthTokens(auth, storage);
        // Return a per-read snapshot whose identity is captured now, from the
        // persisted user record, so it stays A's identity even if another tab
        // replaces the store with B before this request's response arrives (W6).
        return {
          auth: { accessToken: auth.accessToken, refreshToken: auth.refreshToken },
          storage,
          identity: identityFromRecord(raw),
        };
      }
    } catch {
      storage.removeItem(AUTH_STORAGE_KEY);
    }
  }
  // The authenticated React tree can stay mounted briefly while browser
  // storage is being reconciled. Keep using the live in-memory token pair so
  // a protected action never reaches the API without its bearer token.
  return runtimeAuth;
}

function readAuthFromStorage(storage: Storage): PersistedAuth | null {
  const raw = storage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const auth = JSON.parse(raw) as PersistedAuth;
    return auth.accessToken && auth.refreshToken ? auth : null;
  } catch {
    return null;
  }
}

/**
 * A stable identity for a persisted session record, used to tell a same-account
 * token rotation apart from a different account replacing the session (W6). The
 * persisted record carries the signed-in `user` (the storage-event handler
 * requires it), so the user id is the authoritative anchor; fall back to the
 * access token's JWT subject, then null when neither is available (which
 * classifies as a replacement — the safe default).
 */
function identityFromRecord(raw: string): string | null {
  try {
    const record = JSON.parse(raw) as {
      user?: { id?: string; email?: string };
      accessToken?: string;
    };
    if (record.user?.id) return `user:${record.user.id}`;
    if (record.user?.email) return `email:${record.user.email}`;
    if (record.accessToken) return jwtSubjectScopeKey(record.accessToken, "") || null;
    return null;
  } catch {
    return null;
  }
}

function readSessionIdentity(storage: Storage): string | null {
  const raw = storage.getItem(AUTH_STORAGE_KEY);
  return raw ? identityFromRecord(raw) : null;
}

function clearAuthStorage(storage: Storage) {
  // Clear only the store whose session actually expired. A refresh failure on
  // one session (e.g. a sessionStorage tab) must never delete a different,
  // still-valid login living in the other store — that cross-store wipe is
  // exactly how a stale A-refresh 401 used to sign out a newer B login (W6).
  // forgetAuthTokens advances the auth generation, invalidating any in-flight
  // refresh/restore started under the old identity in this tab (W6).
  forgetAuthTokens();
  if (typeof window === "undefined") return;
  storage.removeItem(AUTH_STORAGE_KEY);
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function parseBody<T>(res: Response): Promise<ApiEnvelope<T> | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    // Proxies and platform errors sometimes return HTML. Preserve the real
    // HTTP status instead of replacing it with a confusing JSON parse error.
    return null;
  }
}

function apiErrorMessage<T>(res: Response, body: ApiEnvelope<T> | null): string {
  if (body?.error?.message) {
    if (body.error.code === "BANK_DETAILS_REQUIRED") {
      const employees = body.error.details?.employees;
      if (Array.isArray(employees) && employees.length > 0) {
        return `${body.error.message} Missing: ${employees.join(", ")}`;
      }
    }
    return body.error.message;
  }

  const validation = body as FastApiValidationError | null;
  const firstValidationError = validation?.detail?.[0];
  if (firstValidationError?.msg) {
    const field = firstValidationError.loc?.filter((part) => part !== "body").join(".");
    return field ? `${field}: ${firstValidationError.msg}` : firstValidationError.msg;
  }

  return res.statusText ? `API ${res.status}: ${res.statusText}` : `API ${res.status}`;
}

async function refreshAuthTokens(authLocation: PersistedAuthLocation): Promise<RefreshedTokens> {
  const startedGeneration = currentAuthGeneration();
  const attemptedRefreshToken = authLocation.auth.refreshToken;
  // The identity this refresh belongs to. Prefer the identity captured when the
  // triggering request STARTED (authLocation.identity): a cross-tab replacement
  // (B) can land before the original request's 401 returns, so re-reading the
  // store here would wrongly capture B and mis-classify the replacement as a
  // same-account rotation. Fall back to the store, then the JWT subject (W6).
  const attemptedIdentity =
    authLocation.identity ??
    readSessionIdentity(authLocation.storage) ??
    (jwtSubjectScopeKey(authLocation.auth.accessToken, "") || null);

  // Join an already-running refresh only when it belongs to the SAME account.
  // Otherwise A's stale request would ride B's in-flight refresh and retry under
  // B's fresh token. When identities can't be matched (unknown), don't pool —
  // run an own refresh whose ownership check then classifies and aborts (W6).
  if (
    refreshInFlight &&
    refreshInFlight.identity !== null &&
    attemptedIdentity !== null &&
    refreshInFlight.identity === attemptedIdentity
  ) {
    return refreshInFlight.promise;
  }

  // Read the store once and classify how it now relates to this refresh. Every
  // continuation branches on this instead of a bare token-equality check.
  const ownershipNow = (): { pair: PersistedAuth | null; ownership: RefreshOwnership } => {
    const pair = readAuthFromStorage(authLocation.storage);
    const ownership = classifyRefreshOwnership({
      stored: pair,
      attemptedRefreshToken,
      storedIdentity: readSessionIdentity(authLocation.storage),
      attemptedIdentity,
    });
    return { pair, ownership };
  };
  const adopt = (pair: PersistedAuth): RefreshedTokens => ({
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
  });
  const sessionEnded = () =>
    new ApiClientError(
      "Your session has ended. Please sign in again.",
      "AUTH_SESSION_ENDED",
      401,
    );

  const refreshOnce = async () => {
    // Before spending a network round-trip: if the same account already rotated
    // its pair in another tab, adopt it; if a different account has replaced the
    // session, this refresh is obsolete and must not run under the new identity.
    const before = ownershipNow();
    if (before.ownership === "rotated" && before.pair) return adopt(before.pair);
    if (before.ownership === "replaced") throw sessionEnded();

    const res = await fetchWithTimeout(apiUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: attemptedRefreshToken }),
    });
    const body = await parseBody<RefreshedTokens>(res);
    const tokens = body?.data;
    if (!res.ok || body?.success === false || !tokens?.access_token || !tokens.refresh_token) {
      // Refresh tokens rotate once. If another tab won the race, its new pair is
      // already in shared storage and this 401 must not sign every tab out.
      let after = ownershipNow();
      if (after.ownership !== "rotated" && authLocation.storage === localStorage) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
        after = ownershipNow();
      }
      if (after.ownership === "rotated" && after.pair) return adopt(after.pair);
      // A different account now owns the store, or it was logged out entirely:
      // never clear their login or resurrect a dead one — just fail this request.
      if (after.ownership === "replaced" || after.ownership === "cleared") {
        throw sessionEnded();
      }
      // Only a genuine auth rejection (the refresh token is invalid/expired)
      // may clear the saved session. A transient server outage (5xx) or a
      // malformed 2xx must keep the tokens so a retry can recover, instead of
      // deleting the login on a temporary blip (W7).
      if (refreshFailureClears(res.status)) {
        // The store still holds this exact session ("current"); a real expiry.
        // Still guard on the in-tab generation, and clear only this refresh's
        // own store so a sibling session in the other store is never wiped (W6).
        if (!isAuthGenerationStale(startedGeneration)) {
          clearAuthStorage(authLocation.storage);
        }
        throw new ApiClientError(
          body?.error?.message ?? "Your session has expired. Please sign in again.",
          body?.error?.code ?? "AUTH_EXPIRED",
          res.status,
        );
      }
      throw new ApiClientError(
        body?.error?.message ?? "Could not refresh your session. Please retry.",
        body?.error?.code ?? "AUTH_REFRESH_FAILED",
        res.status || 503,
      );
    }

    if (isAuthGenerationStale(startedGeneration)) {
      // A logout or account switch happened while this refresh was in flight.
      // Do not resurrect cleared credentials; fail the triggering request (W6).
      throw sessionEnded();
    }

    // Cross-tab guard (mirrors the in-tab generation check above), evaluated
    // after the successful response:
    //  - rotated:  the same account's newer pair won elsewhere — adopt it and
    //              let the original request retry under the same identity.
    //  - replaced: a different account owns the store — do NOT overwrite it and
    //              do NOT hand our result to the caller, or A's pending request
    //              would replay under B's authority (W6).
    //  - cleared:  the store was logged out mid-flight — never recreate it (W6).
    const after = ownershipNow();
    if (after.ownership === "rotated" && after.pair) return adopt(after.pair);
    if (after.ownership === "replaced" || after.ownership === "cleared") {
      throw sessionEnded();
    }

    const raw = authLocation.storage.getItem(AUTH_STORAGE_KEY);
    let persisted: Record<string, unknown> = {};
    if (raw) {
      try {
        persisted = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // A corrupt auth record should be replaced by the valid refreshed pair.
      }
    }
    authLocation.storage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        ...persisted,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      }),
    );
    rememberAuthTokens(
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      },
      authLocation.storage,
    );
    window.dispatchEvent(
      new CustomEvent(AUTH_REFRESHED_EVENT, {
        detail: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token },
      }),
    );
    return tokens;
  };

  const lockManager = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const pendingRefresh: Promise<RefreshedTokens> =
    authLocation.storage === localStorage && lockManager
      ? lockManager.request(AUTH_REFRESH_LOCK, refreshOnce).then((tokens) => tokens)
      : refreshOnce();
  refreshInFlight = { identity: attemptedIdentity, promise: pendingRefresh };

  try {
    return await pendingRefresh;
  } finally {
    // Only clear the slot if it is still ours — a different-identity refresh may
    // have replaced it after we chose not to pool with the previous one.
    if (refreshInFlight?.promise === pendingRefresh) refreshInFlight = null;
  }
}

/** Refresh an expiring dashboard session without waiting for a user action. */
export async function refreshAuthIfNeeded(force = false) {
  const authLocation = readAuth();
  if (!authLocation) return false;
  const expiresAt = accessTokenExpiresAt(authLocation.auth.accessToken);
  const shouldRefresh = force || (expiresAt !== null && expiresAt - Date.now() <= 120_000);
  if (!shouldRefresh) return false;
  await refreshAuthTokens(authLocation);
  return true;
}

async function request<T>(
  path: string,
  init: RequestInit,
  token?: string,
): Promise<{ res: Response; body: ApiEnvelope<T> | null }> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!headers.has("Content-Type") && init.body && !isFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetchWithTimeout(apiUrl(path), { ...init, headers });
  return { res, body: await parseBody<T>(res) };
}

function shouldRefresh(path: string, tokenOverride?: string) {
  return !tokenOverride && !["/auth/login", "/auth/refresh", "/auth/logout"].includes(path);
}

export function apiUrl(path: string) {
  const runtimeOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = resolveApiUrl(API_BASE_URL, path, runtimeOrigin);
  if (!url) {
    throw new ApiClientError(
      "The requested URL is outside the configured Khaliduo API.",
      "UNSAFE_API_URL",
      400,
    );
  }
  return url;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  tokenOverride?: string,
): Promise<T> {
  const authLocation = readAuth();
  const token = tokenOverride ?? authLocation?.auth.accessToken;
  const execute = async () => {
    let { res, body } = await request<T>(path, init, token);

    if (res.status === 401 && authLocation && shouldRefresh(path, tokenOverride)) {
      const tokens = await refreshAuthTokens(authLocation);
      ({ res, body } = await request<T>(path, init, tokens.access_token));
    }

    if (!res.ok || body?.success === false) {
      throw new ApiClientError(
        apiErrorMessage(res, body),
        body?.error?.code ?? "API_ERROR",
        res.status,
      );
    }
    return (body?.data ?? ({} as T)) as T;
  };

  return coalesceInFlight(requestDedupeKey("data", path, init, token), execute);
}

export async function apiFetchWithMeta<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const authLocation = readAuth();
  const token = authLocation?.auth.accessToken;
  const execute = async () => {
    let { res, body } = await request<T>(path, init, token);
    if (res.status === 401 && authLocation && shouldRefresh(path)) {
      const tokens = await refreshAuthTokens(authLocation);
      ({ res, body } = await request<T>(path, init, tokens.access_token));
    }
    if (!res.ok || body?.success === false) {
      throw new ApiClientError(
        apiErrorMessage(res, body),
        body?.error?.code ?? "API_ERROR",
        res.status,
      );
    }
    return { data: (body?.data ?? ({} as T)) as T, meta: body?.meta ?? {} };
  };

  return coalesceInFlight(requestDedupeKey("meta", path, init, token), execute);
}

export async function apiFile(
  path: string,
  signal?: AbortSignal,
  tokenOverride?: string,
): Promise<Blob> {
  const authLocation = tokenOverride ? null : readAuth();
  const token = tokenOverride ?? authLocation?.auth.accessToken;
  const fetchFile = (token?: string) =>
    fetchWithTimeout(apiUrl(path), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
    });

  let res = await fetchFile(token);
  if (res.status === 401 && authLocation) {
    const tokens = await refreshAuthTokens(authLocation);
    res = await fetchFile(tokens.access_token);
  }
  if (!res.ok) {
    const body = await parseBody<unknown>(res);
    throw new ApiClientError(
      apiErrorMessage(res, body),
      body?.error?.code ?? "API_ERROR",
      res.status,
    );
  }
  return res.blob();
}

/**
 * Keep protected screenshot grids from opening dozens of authenticated file
 * requests at once. Queued requests are cancelled after navigation or paging.
 */
export function apiImageFile(
  path: string,
  signal?: AbortSignal,
  tokenOverride?: string,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }

    const request: QueuedImageRequest = {
      signal,
      reject,
      abort: () => {
        const index = queuedImageRequests.indexOf(request);
        if (index >= 0) queuedImageRequests.splice(index, 1);
        reject(abortError(signal));
      },
      run: () => {
        apiFile(path, signal, tokenOverride)
          .then(resolve, reject)
          .finally(() => {
            activeImageRequests = Math.max(0, activeImageRequests - 1);
            drainImageQueue();
          });
      },
    };

    signal?.addEventListener("abort", request.abort, { once: true });
    queuedImageRequests.push(request);
    drainImageQueue();
  });
}

export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function toMinutes(seconds?: number | null) {
  return Math.round((seconds ?? 0) / 60);
}
