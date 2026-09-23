import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedMeetingEnd,
  deriveActiveMeeting,
  meetingSyncLabel,
  mergeMeetingsForDisplay,
  nextSyncStep,
  type LocalMeetingRecord,
  type ServerMeetingRow,
} from "../electron/services/meetingStore.ts";

function record(overrides: Partial<LocalMeetingRecord> = {}): LocalMeetingRecord {
  return {
    idempotencyKey: overrides.idempotencyKey ?? "key-1",
    deviceId: "dev-1",
    title: overrides.title ?? "Client call",
    reason: "sync",
    startedAt: overrides.startedAt ?? "2026-09-10T09:00:00.000Z",
    expectedEndAt: overrides.expectedEndAt ?? "2026-09-10T10:00:00.000Z",
    endedAt: overrides.endedAt ?? null,
    workSessionId: null,
    projectId: null,
    taskId: null,
    syncState: overrides.syncState ?? "start_pending",
    lastError: overrides.lastError ?? null,
    serverId: overrides.serverId ?? null,
    status: overrides.status ?? null,
    lifecycleState: overrides.lifecycleState ?? null,
    recordedSeconds: overrides.recordedSeconds ?? null,
    approvedSeconds: overrides.approvedSeconds ?? null,
    updatedAt: "2026-09-10T09:00:00.000Z",
  };
}

function serverRow(overrides: Partial<ServerMeetingRow> = {}): ServerMeetingRow {
  return {
    id: overrides.id ?? "srv-1",
    idempotency_key: overrides.idempotency_key ?? "key-1",
    title: overrides.title ?? "Client call",
    reason: "sync",
    started_at: overrides.started_at ?? "2026-09-10T09:00:00.000Z",
    expected_end_at: overrides.expected_end_at ?? "2026-09-10T10:00:00.000Z",
    ended_at: overrides.ended_at ?? null,
    lifecycle_state: overrides.lifecycle_state ?? "active",
    status: overrides.status ?? "pending",
    recorded_seconds: overrides.recorded_seconds ?? 0,
    approved_seconds: overrides.approved_seconds ?? null,
  };
}

test("deriveActiveMeeting returns the running record and ignores synced/ended", () => {
  const running = record({ idempotencyKey: "a", syncState: "start_synced" });
  const ended = record({ idempotencyKey: "b", endedAt: "2026-09-10T09:30:00Z", syncState: "synced" });
  assert.equal(deriveActiveMeeting([ended, running])?.idempotencyKey, "a");
  assert.equal(deriveActiveMeeting([ended]), null);
});

test("a rejected start is not a running meeting (never blocks or silences idle)", () => {
  const failed = record({ syncState: "start_error" });
  assert.equal(deriveActiveMeeting([failed]), null);
});

test("an ended meeting awaiting sync shows its locally recorded duration", () => {
  const ended = record({
    serverId: "srv-1",
    syncState: "end_pending",
    lifecycleState: "active",
    recordedSeconds: 0,
    endedAt: new Date(Date.parse(record({}).startedAt) + 15 * 60_000).toISOString(),
  });
  const [shown] = mergeMeetingsForDisplay([ended], []);
  assert.equal(shown.lifecycleState, "ended");
  assert.equal(shown.recordedSeconds, 15 * 60);
});

test("nextSyncStep drives start-before-end and stops when synced", () => {
  assert.equal(nextSyncStep(record({ serverId: null })), "start");
  assert.equal(
    nextSyncStep(record({ serverId: "srv-1", syncState: "start_synced" })),
    null,
  );
  assert.equal(
    nextSyncStep(
      record({ serverId: "srv-1", endedAt: "2026-09-10T09:30:00Z", syncState: "end_pending" }),
    ),
    "end",
  );
  assert.equal(nextSyncStep(record({ serverId: "srv-1", syncState: "synced" })), null);
  // End must never be attempted before the start is confirmed.
  assert.equal(
    nextSyncStep(record({ serverId: null, endedAt: "2026-09-10T09:30:00Z" })),
    "start",
  );
});

test("merge shows a not-yet-synced local meeting even with no server row", () => {
  const merged = mergeMeetingsForDisplay([record({ syncState: "start_pending" })], []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].syncState, "start_pending");
  assert.equal(merged[0].lifecycleState, "active");
  assert.equal(merged[0].idempotencyKey, "key-1");
});

test("merge defers to the server row once the meeting is fully synced", () => {
  const local = record({
    endedAt: "2026-09-10T09:30:00Z",
    syncState: "synced",
    serverId: "srv-1",
  });
  const server = serverRow({
    ended_at: "2026-09-10T09:30:00Z",
    lifecycle_state: "ended",
    status: "approved",
    recorded_seconds: 1800,
  });
  const merged = mergeMeetingsForDisplay([local], [server]);
  assert.equal(merged.length, 1, "local + server with same key collapse to one row");
  assert.equal(merged[0].syncState, null);
  assert.equal(merged[0].status, "approved");
  assert.equal(merged[0].recordedSeconds, 1800);
  assert.equal(merged[0].id, "srv-1");
});

test("merge includes server-only rows and dedupes by idempotency key", () => {
  const local = record({ idempotencyKey: "key-1", syncState: "start_synced", serverId: "srv-1" });
  const serverMatch = serverRow({ id: "srv-1", idempotency_key: "key-1" });
  const serverOther = serverRow({
    id: "srv-2",
    idempotency_key: "key-2",
    started_at: "2026-09-10T08:00:00Z",
  });
  const merged = mergeMeetingsForDisplay([local], [serverMatch, serverOther]);
  assert.equal(merged.length, 2);
  // Newest first by start time.
  assert.equal(merged[0].idempotencyKey, "key-1");
  assert.equal(merged[1].idempotencyKey, "key-2");
});

test("boundedMeetingEnd clamps to expected end and never before start", () => {
  const started = "2026-09-10T09:00:00.000Z";
  const expected = "2026-09-10T10:00:00.000Z";
  // now before expected -> now
  assert.equal(
    boundedMeetingEnd(started, expected, Date.parse("2026-09-10T09:30:00Z")),
    "2026-09-10T09:30:00.000Z",
  );
  // now after expected -> clamp to expected
  assert.equal(
    boundedMeetingEnd(started, expected, Date.parse("2026-09-10T12:00:00Z")),
    expected,
  );
  // now before start -> clamp up to start
  assert.equal(
    boundedMeetingEnd(started, expected, Date.parse("2026-09-10T08:00:00Z")),
    started,
  );
});

test("sync labels never say Pending review before the end is confirmed", () => {
  assert.equal(meetingSyncLabel("start_pending", "pending", "active"), "In progress · waiting to sync");
  assert.equal(meetingSyncLabel("start_synced", "pending", "active"), "In progress · synced");
  assert.equal(meetingSyncLabel("end_pending", "pending", "ended"), "Ending · waiting to sync");
  assert.equal(meetingSyncLabel("end_error", "pending", "ended"), "Sync failed · tap Retry");
  assert.equal(meetingSyncLabel("synced", "pending", "ended"), "Pending review");
  assert.equal(meetingSyncLabel(null, "approved", "ended"), "Approved");
});
