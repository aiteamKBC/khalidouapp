import type { AxiosError } from "axios";

// Decisions about whether a failed request may be sent again, kept separate
// from the axios wiring so the safety rule is unit-tested in isolation.

type RetryableBody = unknown;

export type RetryDecisionConfig = {
  method?: string;
  data?: RetryableBody;
};

// A transport failure is one where no HTTP response ever came back — the
// request did not reach, or was not answered by, the application. A real HTTP
// status (even 5xx) is the server's answer and is never retried here.
export function isTransientTransportError(error: Pick<AxiosError, "response" | "code">): boolean {
  if (error.response) return false;
  const code = error.code ?? "";
  return [
    "ECONNABORTED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EPIPE",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
  ].includes(code);
}

// Only replay a request that is safe to send twice: idempotent methods, or a
// body that carries its own idempotency/event id (heartbeats, events, the
// request-status updates) which the server already de-duplicates. Plain POSTs
// such as creating a task are left for the caller to retry, so a dropped
// connection can never silently double them.
export function isReplayable(config: RetryDecisionConfig): boolean {
  const method = (config.method ?? "get").toLowerCase();
  if (method === "get" || method === "head" || method === "options") return true;
  const body = config.data;
  // A multipart upload body (FormData) is streamed and has no readable text
  // here; those are screenshot uploads, which the offline queue already retries.
  const asText =
    typeof body === "string"
      ? body
      : body && typeof body === "object" && body.constructor?.name !== "FormData"
        ? safeStringify(body)
        : "";
  return asText.includes("idempotency_key") || asText.includes("event_id");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
