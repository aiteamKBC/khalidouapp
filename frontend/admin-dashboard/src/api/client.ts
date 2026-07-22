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
        return { auth, storage };
      }
    } catch {
      storage.removeItem(AUTH_STORAGE_KEY);
    }
  }
  return null;
}

function clearAuth() {
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
}

export async function apiFetchWithMeta<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const authLocation = readAuth();
  let { res, body } = await request<T>(path, init, authLocation?.auth.accessToken);
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
}

export async function apiFile(path: string): Promise<Blob> {
  const authLocation = readAuth();
  const fetchFile = (token?: string) =>
    fetchWithTimeout(apiUrl(path), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

  let res = await fetchFile(authLocation?.auth.accessToken);
  if (res.status === 401 && authLocation) {
    const tokens = await refreshAuthTokens(authLocation);
    res = await fetchFile(tokens.access_token);
  }
  if (!res.ok) {
    throw new Error(`File ${res.status}: ${res.statusText}`);
  }
  return res.blob();
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
