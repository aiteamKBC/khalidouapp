import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = path.resolve(E2E_DIR, "..");
export const BACKEND_DIR = path.join(REPO_DIR, "backend");
export const DASHBOARD_DIR = path.join(REPO_DIR, "frontend", "admin-dashboard");
export const DESKTOP_DIR = path.join(REPO_DIR, "frontend", "desktop-agent");
export const RUNTIME_DIR = path.join(E2E_DIR, ".runtime");
export const PYTHON = path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe");

export const DB_PORT = 55432;
export const API_PORT = 8010;
export const PROXY_PORT = 8011;
export const WEB_PORT = 5175;
export const DEAD_PORT = 59999;

export const DATABASE_URL = `postgresql+psycopg://khaliduo_e2e:khaliduo_e2e_password@127.0.0.1:${DB_PORT}/khaliduo_e2e`;
export const API_URL = `http://127.0.0.1:${API_PORT}/api/v1`;
/** What the desktop app talks to: a switchable proxy in front of API_URL. */
export const DESKTOP_API_URL = `http://127.0.0.1:${PROXY_PORT}/api/v1`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

export const SEED_FILE = path.join(RUNTIME_DIR, "seed.json");
export const SECRETS_FILE = path.join(RUNTIME_DIR, "secrets.json");
export const PIDS_FILE = path.join(RUNTIME_DIR, "pids.json");

/**
 * Refuses to run when anything could reach a real database or server. The
 * repo's own .env files point at the production Neon database, so every value
 * the stack uses is checked here before any process starts.
 */
export function assertIsolated(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;
    const lower = value.toLowerCase();
    if (lower.includes("neon.tech") || lower.includes("kentbusinesscollege")) {
      throw new Error(`E2E safety guard: ${name} points at a real environment (${value}).`);
    }
    if (/^(postgres|postgresql|https?)(\+\w+)?:\/\//.test(lower)) {
      const host = new URL(lower.replace(/^postgresql\+\w+:/, "postgresql:")).hostname;
      if (host !== "127.0.0.1" && host !== "localhost") {
        throw new Error(`E2E safety guard: ${name} must be local, got host "${host}".`);
      }
    }
  }
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

export type Secrets = { jwt: string; device: string; salary: string };

/** Environment for every backend process (alembic, seed, uvicorn). */
export function backendEnv(secrets: Secrets): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    // Only what the OS needs, then the explicit test configuration. Nothing is
    // inherited from backend/.env: processes run with cwd=RUNTIME_DIR, where
    // no .env exists, and these values take precedence regardless.
    SYSTEMROOT: process.env.SYSTEMROOT,
    PATH: process.env.PATH,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    PYTHONPATH: BACKEND_DIR,
    PYTHONUNBUFFERED: "1",
    PYTHONUTF8: "1",
    APP_ENV: "development",
    DATABASE_URL,
    JWT_SECRET_KEY: secrets.jwt,
    DEVICE_TOKEN_SECRET: secrets.device,
    SALARY_ENCRYPTION_KEY: secrets.salary,
    // pydantic-settings parses list fields from the environment as JSON.
    CORS_ORIGINS: JSON.stringify([WEB_URL, `http://localhost:${WEB_PORT}`]),
    APP_PUBLIC_URL: WEB_URL,
    SCREENSHOT_STORAGE_TYPE: "local",
    SCREENSHOT_STORAGE_PATH: path.join(RUNTIME_DIR, "screenshots"),
    DESKTOP_INSTALLER_PATH: path.join(RUNTIME_DIR, "no-installer.exe"),
    DESKTOP_UPDATE_DIRECTORY: path.join(RUNTIME_DIR, "no-updates"),
    // Email: nothing configured, so the backend logs messages to the console.
    GRAPH_TENANT_ID: "",
    GRAPH_CLIENT_ID: "",
    GRAPH_CLIENT_SECRET: "",
    GRAPH_SENDER: "",
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    SMTP_FROM: "",
    IP_GEOLOCATION_URL: `http://127.0.0.1:${DEAD_PORT}/{ip}`,
    IP_GEOLOCATION_TIMEOUT_SECONDS: "0.25",
  };
  assertIsolated({ DATABASE_URL: env.DATABASE_URL, APP_PUBLIC_URL: env.APP_PUBLIC_URL });
  return env;
}
