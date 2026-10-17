import crypto from "node:crypto";
import { API_URL, SEED_FILE, readJson } from "../lib/env.ts";

export type SeedPerson = { id: string; email: string; name: string; code?: string };
export type Seed = {
  companyId: string;
  timezone: string;
  seededAt: string;
  adminPassword: string;
  employeePassword: string;
  admins: Record<"super" | "hr" | "lead" | "custom", SeedPerson>;
  teams: Record<"a" | "b", { id: string; name: string }>;
  employees: Record<"day" | "late" | "other" | "archive", SeedPerson>;
};
export type AdminKey = keyof Seed["admins"];
export type EmployeeKey = keyof Seed["employees"];

let cachedSeed: Seed | null = null;
export function seed(): Seed {
  cachedSeed ??= readJson<Seed>(SEED_FILE);
  return cachedSeed;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, path: string) {
    super(`${path} -> HTTP ${status}: ${JSON.stringify(body).slice(0, 400)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Every login gets its own X-Forwarded-For address. 127.0.0.1 is a trusted
 * proxy for the backend, so this keeps the suite clear of the per-IP login
 * rate limit (10/min) while the limit itself stays under test in auth.spec.
 */
export function fakeClientIp() {
  const b = crypto.randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2] || 1}`;
}

export async function request<T = any>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (options.raw) return response as T;
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, body, `${method} ${path}`);
  return (body && typeof body === "object" && "data" in body ? body.data : body) as T;
}

export type AdminSession = { accessToken: string; refreshToken: string; user: any };

export async function adminLogin(key: AdminKey): Promise<AdminSession> {
  const data = await request("POST", "/auth/login", {
    body: { email: seed().admins[key].email, password: seed().adminPassword },
    headers: { "x-forwarded-for": fakeClientIp() },
  });
  return { accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user };
}

/** A logged-in admin API client, e.g. `const hr = await asAdmin("hr")`. */
export async function asAdmin(key: AdminKey) {
  const session = await adminLogin(key);
  const call = <T = any>(method: string, path: string, body?: unknown) =>
    request<T>(method, path, { token: session.accessToken, body });
  return {
    session,
    get: <T = any>(path: string) => call<T>("GET", path),
    post: <T = any>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
    patch: <T = any>(path: string, body?: unknown) => call<T>("PATCH", path, body ?? {}),
    put: <T = any>(path: string, body?: unknown) => call<T>("PUT", path, body ?? {}),
    delete: <T = any>(path: string) => call<T>("DELETE", path),
    /** Status code only; for asserting that access is refused. */
    status: async (method: string, path: string, body?: unknown) =>
      ((await request<Response>(method, path, { token: session.accessToken, body, raw: true })) as Response).status,
  };
}
export type AdminApi = Awaited<ReturnType<typeof asAdmin>>;

export async function employeeLogin(key: EmployeeKey): Promise<string> {
  const data = await request("POST", "/employee-auth/login", {
    body: { email: seed().employees[key].email, password: seed().employeePassword },
    headers: { "x-forwarded-for": fakeClientIp() },
  });
  return data.access_token;
}

/**
 * A scripted desktop agent for employees the real Electron app does not play
 * (e.g. `late`, whose late start feeds the payroll late-allowance check).
 */
export async function headlessAgent(key: EmployeeKey) {
  const employeeToken = await employeeLogin(key);
  const enrollment = await request("POST", "/agent/enroll-authenticated", {
    token: employeeToken,
    body: {
      device: {
        installation_id: `e2e-headless-${key}-${crypto.randomUUID()}`,
        device_name: `E2E headless ${key}`,
        operating_system: "Windows 10 (E2E)",
        agent_version: "1.1.100",
        timezone: seed().timezone,
      },
    },
  });
  const token: string = enrollment.device_token;
  const call = <T = any>(method: string, path: string, body?: unknown) => request<T>(method, `/agent${path}`, { token, body });
  return {
    token,
    enrollment,
    call,
    start: () => call("POST", "/sessions/start", {}),
    heartbeat: (sessionId: string, status = "active", idleSeconds = 0) =>
      call("POST", `/sessions/${sessionId}/heartbeat`, {
        event_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        status,
        idle_seconds: idleSeconds,
        agent_version: "1.1.100",
      }),
    end: (sessionId: string) =>
      call("POST", `/sessions/${sessionId}/end`, { event_id: crypto.randomUUID(), ended_at: new Date().toISOString(), reason: "e2e" }),
  };
}

/** Today's date in the company timezone, as YYYY-MM-DD. */
export function companyToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: seed().timezone }).format(new Date());
}

/** Wall-clock "HH:MM" in the company timezone, offset by `minutes`. */
export function companyClock(minutes = 0) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: seed().timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(Date.now() + minutes * 60_000),
  );
}

export async function poll<T>(
  what: string,
  read: () => Promise<T>,
  until: (value: T) => boolean,
  { timeoutMs = 30_000, intervalMs = 1_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (until(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timed out waiting for ${what}. Last value: ${JSON.stringify(last)?.slice(0, 600)}${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}
