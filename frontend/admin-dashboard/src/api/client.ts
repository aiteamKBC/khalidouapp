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
};

type RefreshedTokens = {
  access_token: string;
  refresh_token: string;
};

const AUTH_STORAGE_KEY = "khaliduo.auth";
const AUTH_REFRESHED_EVENT = "khaliduo:auth-refreshed";
const AUTH_EXPIRED_EVENT = "khaliduo:auth-expired";

let refreshInFlight: Promise<RefreshedTokens> | null = null;
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
  runtimeAuth = { auth, storage };
}

export function forgetAuthTokens() {
  runtimeAuth = null;
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
        return runtimeAuth;
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

function clearAuth() {
  forgetAuthTokens();
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
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
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const res = await fetchWithTimeout(apiUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: authLocation.auth.refreshToken }),
    });
    const body = await parseBody<RefreshedTokens>(res);
    const tokens = body?.data;
    if (!res.ok || body?.success === false || !tokens?.access_token || !tokens.refresh_token) {
      clearAuth();
      throw new Error(body?.error?.message ?? "Your session has expired. Please sign in again.");
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
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
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
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  if (path.startsWith("/api/v1/")) {
    return `${API_BASE_URL}${path.slice("/api/v1".length)}`;
  }
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
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

export async function apiFile(path: string, signal?: AbortSignal): Promise<Blob> {
  const authLocation = readAuth();
  const token = tokenOverride ?? authLocation?.auth.accessToken;
  const fetchFile = (token?: string) =>
    fetchWithTimeout(apiUrl(path), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
    });

  let res = await fetchFile(token);
  if (res.status === 401 && authLocation && !tokenOverride) {
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
export function apiImageFile(path: string, signal?: AbortSignal): Promise<Blob> {
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
        apiFile(path, signal)
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
