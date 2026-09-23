// Durable Meeting Mode state, kept on the desktop independently of the server so
// a meeting is visible the instant it starts and never disappears while it waits
// to synchronize. Delivery is confirmed against the server response, not merely
// queued: a meeting is only "Pending review" once the backend has accepted its
// end. This module is pure (no imports) so it can be unit-tested directly.

export type MeetingSyncState =
  // The start has not yet been accepted by the server.
  | "start_pending"
  // The start was accepted; the meeting is running (no end yet).
  | "start_synced"
  // The end is saved locally but not yet accepted by the server.
  | "end_pending"
  // Both start and end are accepted by the server (server row is authoritative).
  | "synced"
  // The start was rejected/errored; retained locally for retry/reconciliation.
  | "start_error"
  // The end was rejected/errored; retained locally for retry/reconciliation.
  | "end_error";

export type LocalMeetingRecord = {
  idempotencyKey: string;
  deviceId: string;
  title: string;
  reason: string;
  startedAt: string;
  expectedEndAt: string;
  endedAt: string | null;
  workSessionId: string | null;
  projectId: string | null;
  taskId: string | null;
  syncState: MeetingSyncState;
  lastError: string | null;
  serverId: string | null;
  status: "pending" | "approved" | "rejected" | null;
  lifecycleState: "active" | "ended" | null;
  recordedSeconds: number | null;
  approvedSeconds: number | null;
  updatedAt: string;
};

export type ServerMeetingRow = {
  id: string;
  idempotency_key?: string | null;
  title: string;
  reason: string;
  started_at: string;
  expected_end_at: string;
  ended_at: string | null;
  lifecycle_state: "active" | "ended";
  status: "pending" | "approved" | "rejected";
  recorded_seconds: number;
  approved_seconds: number | null;
};

export type MeetingDisplay = {
  // Stable React key: the server id when confirmed, else the idempotency key.
  id: string;
  idempotencyKey: string | null;
  title: string;
  reason: string;
  startedAt: string;
  expectedEndAt: string;
  endedAt: string | null;
  lifecycleState: "active" | "ended";
  status: "pending" | "approved" | "rejected";
  recordedSeconds: number;
  approvedSeconds: number | null;
  // null once the meeting is a plain server record (fully synced or from
  // elsewhere); otherwise the local delivery state.
  syncState: MeetingSyncState | null;
  lastError: string | null;
};

export function meetingSyncLabel(
  syncState: MeetingSyncState | null,
  status: "pending" | "approved" | "rejected",
  lifecycleState: "active" | "ended",
): string {
  switch (syncState) {
    case "start_pending":
      return "In progress · waiting to sync";
    case "start_synced":
      return "In progress · synced";
    case "end_pending":
      return "Ending · waiting to sync";
    case "start_error":
    case "end_error":
      return "Sync failed · tap Retry";
    case "synced":
    case null:
    default:
      if (lifecycleState === "active") return "In progress";
      if (status === "approved") return "Approved";
      if (status === "rejected") return "Rejected";
      return "Pending review";
  }
}

/**
 * The single running meeting (an end has not been recorded locally), if any.
 * A start the server definitively rejected (outside shift, overlap, ...) is not
 * running: it must not block a new meeting or silence idle detection. It stays
 * in Recent meetings as a failed row that can be retried.
 */
export function deriveActiveMeeting(
  records: LocalMeetingRecord[],
): LocalMeetingRecord | null {
  const running = records
    .filter(
      (record) =>
        record.endedAt === null &&
        record.syncState !== "synced" &&
        record.syncState !== "start_error",
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return running[0] ?? null;
}

/**
 * The next delivery step a record needs, or null when it is up to date.
 * Start must be confirmed (serverId present) before End is attempted.
 */
export function nextSyncStep(
  record: LocalMeetingRecord,
): "start" | "end" | null {
  if (record.syncState === "synced") return null;
  if (record.serverId === null) return "start";
  if (record.endedAt !== null) return "end";
  return null;
}

function localMeetingSeconds(record: LocalMeetingRecord): number {
  if (record.endedAt === null) return 0;
  const seconds = Math.floor(
    (Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000,
  );
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

function recordToDisplay(record: LocalMeetingRecord): MeetingDisplay {
  // A locally recorded end is authoritative for display until the server
  // confirms it; the server's pre-end snapshot still says "active" / 0s.
  const lifecycleState: "active" | "ended" =
    record.endedAt !== null ? "ended" : (record.lifecycleState ?? "active");
  return {
    id: record.serverId ?? record.idempotencyKey,
    idempotencyKey: record.idempotencyKey,
    title: record.title,
    reason: record.reason,
    startedAt: record.startedAt,
    expectedEndAt: record.expectedEndAt,
    endedAt: record.endedAt,
    lifecycleState,
    status: record.status ?? "pending",
    recordedSeconds:
      record.endedAt !== null && record.syncState !== "synced"
        ? localMeetingSeconds(record)
        : (record.recordedSeconds ?? 0),
    approvedSeconds: record.approvedSeconds ?? null,
    syncState: record.syncState,
    lastError: record.lastError,
  };
}

function serverRowToDisplay(row: ServerMeetingRow): MeetingDisplay {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key ?? null,
    title: row.title,
    reason: row.reason,
    startedAt: row.started_at,
    expectedEndAt: row.expected_end_at,
    endedAt: row.ended_at,
    lifecycleState: row.lifecycle_state,
    status: row.status,
    recordedSeconds: row.recorded_seconds,
    approvedSeconds: row.approved_seconds,
    syncState: null,
    lastError: null,
  };
}

/**
 * Merge durable local records with server rows into one de-duplicated list for
 * the UI, keyed by the stable idempotency key.
 *
 * - A fully-synced local record defers to its authoritative server row.
 * - A not-yet-synced local record is shown from local state (so it never
 *   disappears while waiting), overlaid with any server status already known.
 * - Server rows without a matching local record (e.g. confirmed on another
 *   device, or older than the local store) are included as-is.
 * Newest first by start time.
 */
export function mergeMeetingsForDisplay(
  records: LocalMeetingRecord[],
  serverRows: ServerMeetingRow[],
): MeetingDisplay[] {
  const serverByKey = new Map<string, ServerMeetingRow>();
  for (const row of serverRows) {
    if (row.idempotency_key) serverByKey.set(row.idempotency_key, row);
  }

  const consumedServerIds = new Set<string>();
  const consumedKeys = new Set<string>();
  const display: MeetingDisplay[] = [];

  for (const record of records) {
    consumedKeys.add(record.idempotencyKey);
    const serverRow = serverByKey.get(record.idempotencyKey) ?? null;
    if (serverRow) consumedServerIds.add(serverRow.id);
    if (record.syncState === "synced" && serverRow) {
      // The end is confirmed; the server row is authoritative.
      display.push(serverRowToDisplay(serverRow));
      continue;
    }
    // Show local state, but adopt the server's review decision / recorded time
    // when the server already knows about this meeting.
    const local = recordToDisplay(record);
    if (serverRow) {
      local.id = serverRow.id;
      local.status = serverRow.status;
      local.recordedSeconds =
        record.endedAt !== null ? serverRow.recorded_seconds : local.recordedSeconds;
      local.approvedSeconds = serverRow.approved_seconds;
    }
    display.push(local);
  }

  for (const row of serverRows) {
    if (consumedServerIds.has(row.id)) continue;
    if (row.idempotency_key && consumedKeys.has(row.idempotency_key)) continue;
    display.push(serverRowToDisplay(row));
  }

  return display.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/**
 * Clamp a meeting end to no later than its expected end (which the server also
 * clamps to the shift end). A forgotten meeting after sleep/crash closes there.
 */
export function boundedMeetingEnd(
  startedAt: string,
  expectedEndAt: string,
  nowMs: number,
): string {
  const startedMs = Date.parse(startedAt);
  const expectedMs = Date.parse(expectedEndAt);
  const upper = Number.isFinite(expectedMs) ? Math.min(nowMs, expectedMs) : nowMs;
  const bounded = Math.max(Number.isFinite(startedMs) ? startedMs : nowMs, upper);
  return new Date(bounded).toISOString();
}
