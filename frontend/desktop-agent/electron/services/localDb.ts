import electronMain from 'electron/main';
import initSqlJs, { type Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

const { app } = electronMain;

type SqlValue = string | number | null;

export type PendingEvent = {
  id: string;
  method: string;
  endpoint: string;
  payloadJson: string;
  attempts: number;
};

export type PendingScreenshot = {
  screenshotId: string;
  metadataJson: string;
  filePath: string;
  attempts: number;
};

export type LocalTrackingSession = {
  sessionId: string;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  activeSeconds: number;
  idleSeconds: number;
  lastCheckpointAt: string;
};

export type LocalTrackingEvent = {
  id: string;
  localSessionId: string;
  eventType: string;
  eventTimestamp: string;
  payloadJson: string;
};

let database: Database | null = null;

function dbPath() {
  return path.join(app.getPath('userData'), 'offline.sqlite');
}

function locateSqlWasm(file: string) {
  const candidates = [
    path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function persist() {
  if (!database) {
    return;
  }
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dbPath(), Buffer.from(database.export()));
}

function rows<T>(sql: string, params: SqlValue[] = []): T[] {
  if (!database) {
    throw new Error('Local database is not initialized.');
  }
  const result = database.exec(sql, params);
  if (!result[0]) {
    return [];
  }

  const columns = result[0].columns;
  return result[0].values.map((valueRow) => {
    const row: Record<string, SqlValue> = {};
    columns.forEach((column, index) => {
      row[column] = valueRow[index] as SqlValue;
    });
    return row as T;
  });
}

function nextAttemptAt(attempts: number) {
  const backoffMs = Math.min(5 * 60 * 1000, 10_000 * 2 ** attempts);
  return new Date(Date.now() + backoffMs).toISOString();
}

function ensureColumn(table: string, column: string, definition: string) {
  if (
    rows<{ name: string }>(`pragma table_info(${table})`).some(
      (item) => item.name === column,
    )
  ) {
    return;
  }
  database?.run(`alter table ${table} add column ${column} ${definition}`);
}

export async function initializeLocalDatabase() {
  if (database) {
    return;
  }

  const SQL = await initSqlJs({ locateFile: locateSqlWasm });
  const filePath = dbPath();
  database = fs.existsSync(filePath)
    ? new SQL.Database(fs.readFileSync(filePath))
    : new SQL.Database();

  database.run(`
    create table if not exists device_identity (
      key text primary key,
      value text not null
    );
    create table if not exists local_sessions (
      session_id text primary key,
      started_at text not null,
      ended_at text,
      status text not null,
      active_seconds integer not null default 0,
      idle_seconds integer not null default 0
    );
    create table if not exists local_session_events (
      id text primary key,
      local_session_id text not null,
      event_type text not null,
      event_timestamp text not null,
      payload_json text not null,
      created_at text not null
    );
    create table if not exists pending_events (
      id text primary key,
      method text not null,
      endpoint text not null,
      payload_json text not null,
      idempotency_key text not null,
      status text not null,
      attempts integer not null default 0,
      next_attempt_at text not null,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists pending_screenshots (
      screenshot_id text primary key,
      metadata_json text not null,
      file_path text not null,
      status text not null,
      attempts integer not null default 0,
      next_attempt_at text not null,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists application_settings (
      key text primary key,
      value text not null,
      updated_at text not null
    );
    create table if not exists sync_state (
      key text primary key,
      value text not null,
      updated_at text not null
    );
  `);
  ensureColumn("local_sessions", "device_id", "text");
  ensureColumn("local_sessions", "last_checkpoint_at", "text");
  ensureColumn("local_sessions", "synced_at", "text");
  database.run(
    `create index if not exists ix_local_session_events_session_time
     on local_session_events(local_session_id, event_timestamp, created_at)`,
  );
  const legacyEventRecoveryKey = "pending_event_transient_recovery_v1";
  const legacyEventRecovery = rows<{ value: string }>(
    `select value from sync_state where key = ? limit 1`,
    [legacyEventRecoveryKey],
  )[0];
  if (!legacyEventRecovery) {
    const recoveredAt = new Date().toISOString();
    // Older agents retired every event after ten failures, even when the API
    // was simply offline. Revive those rows once; definitive 4xx rejections
    // will be quarantined again by the current sync policy.
    database.run(
      `update pending_events
       set status = 'failed', attempts = 0, next_attempt_at = ?, updated_at = ?
       where status = 'dead'`,
      [recoveredAt, recoveredAt],
    );
    database.run(
      `insert into sync_state (key, value, updated_at) values (?, ?, ?)`,
      [legacyEventRecoveryKey, recoveredAt, recoveredAt],
    );
  }
  // Permanently rejected screenshots stay quarantined. Reviving them on every
  // launch created an infinite retry loop and could make an otherwise-online
  // device appear offline because of one historical payload.
  persist();
}

export function createLocalTrackingSession(options: {
  sessionId: string;
  deviceId: string;
  startedAt: string;
  status: string;
}) {
  if (!database) return;
  database.run(
    `insert into local_sessions
      (session_id, device_id, started_at, ended_at, status, active_seconds,
       idle_seconds, last_checkpoint_at, synced_at)
     values (?, ?, ?, null, ?, 0, 0, ?, null)`,
    [
      options.sessionId,
      options.deviceId,
      options.startedAt,
      options.status,
      options.startedAt,
    ],
  );
  persist();
}

export function checkpointLocalTrackingSession(options: {
  sessionId: string;
  status: string;
  activeSeconds: number;
  idleSeconds: number;
  checkpointAt?: string;
}) {
  if (!database) return;
  database.run(
    `update local_sessions
     set status = ?, active_seconds = ?, idle_seconds = ?,
         last_checkpoint_at = ?
     where session_id = ? and synced_at is null`,
    [
      options.status,
      Math.max(0, Math.floor(options.activeSeconds)),
      Math.max(0, Math.floor(options.idleSeconds)),
      options.checkpointAt ?? new Date().toISOString(),
      options.sessionId,
    ],
  );
  persist();
}

export function closeLocalTrackingSession(options: {
  sessionId: string;
  endedAt: string;
  status: string;
  activeSeconds: number;
  idleSeconds: number;
}) {
  if (!database) return;
  database.run(
    `update local_sessions
     set ended_at = ?, status = ?, active_seconds = ?, idle_seconds = ?,
         last_checkpoint_at = ?
     where session_id = ? and synced_at is null`,
    [
      options.endedAt,
      options.status,
      Math.max(0, Math.floor(options.activeSeconds)),
      Math.max(0, Math.floor(options.idleSeconds)),
      options.endedAt,
      options.sessionId,
    ],
  );
  persist();
}

export function getOpenLocalTrackingSession(
  deviceId: string,
): LocalTrackingSession | null {
  return (
    rows<LocalTrackingSession>(
      `select session_id as sessionId, device_id as deviceId,
              started_at as startedAt, ended_at as endedAt, status,
              active_seconds as activeSeconds, idle_seconds as idleSeconds,
              coalesce(last_checkpoint_at, started_at) as lastCheckpointAt
       from local_sessions
       where device_id = ? and ended_at is null and synced_at is null
       order by started_at desc, rowid desc
       limit 1`,
      [deviceId],
    )[0] ?? null
  );
}

export function getPendingLocalTrackingSessions(
  deviceId: string,
): LocalTrackingSession[] {
  return rows<LocalTrackingSession>(
    `select session_id as sessionId, device_id as deviceId,
            started_at as startedAt, ended_at as endedAt, status,
            active_seconds as activeSeconds, idle_seconds as idleSeconds,
            coalesce(last_checkpoint_at, started_at) as lastCheckpointAt
     from local_sessions
     where device_id = ? and synced_at is null
     order by started_at asc, rowid asc`,
    [deviceId],
  );
}

export function getPendingLocalTrackingSession(
  sessionId: string,
): LocalTrackingSession | null {
  return (
    rows<LocalTrackingSession>(
      `select session_id as sessionId, device_id as deviceId,
              started_at as startedAt, ended_at as endedAt, status,
              active_seconds as activeSeconds, idle_seconds as idleSeconds,
              coalesce(last_checkpoint_at, started_at) as lastCheckpointAt
       from local_sessions
       where session_id = ? and synced_at is null
       limit 1`,
      [sessionId],
    )[0] ?? null
  );
}

export function markLocalTrackingSessionSynced(
  sessionId: string,
  syncedAt = new Date().toISOString(),
) {
  if (!database) return;
  database.run(
    `update local_sessions set synced_at = ? where session_id = ?`,
    [syncedAt, sessionId],
  );
  database.run(
    `delete from local_session_events where local_session_id = ?`,
    [sessionId],
  );
  persist();
}

export function appendLocalTrackingEvent(options: {
  id: string;
  localSessionId: string;
  eventType: string;
  eventTimestamp: string;
  payload: Record<string, unknown>;
}) {
  if (!database) return;
  database.run(
    `insert or ignore into local_session_events
      (id, local_session_id, event_type, event_timestamp, payload_json, created_at)
     values (?, ?, ?, ?, ?, ?)`,
    [
      options.id,
      options.localSessionId,
      options.eventType,
      options.eventTimestamp,
      JSON.stringify(options.payload),
      new Date().toISOString(),
    ],
  );
  persist();
}

export function getLocalTrackingEvents(
  localSessionId: string,
): LocalTrackingEvent[] {
  return rows<LocalTrackingEvent>(
    `select id, local_session_id as localSessionId, event_type as eventType,
            event_timestamp as eventTimestamp, payload_json as payloadJson
     from local_session_events
     where local_session_id = ?
     order by event_timestamp asc, created_at asc, rowid asc`,
    [localSessionId],
  );
}

export function enqueuePendingEvent(options: {
  id: string;
  method: string;
  endpoint: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}) {
  if (!database) {
    return;
  }
  const now = new Date().toISOString();
  database.run(
    `insert or ignore into pending_events
      (id, method, endpoint, payload_json, idempotency_key, status, attempts, next_attempt_at, created_at, updated_at)
     values (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    [
      options.id,
      options.method,
      options.endpoint,
      JSON.stringify(options.payload),
      options.idempotencyKey,
      now,
      now,
      now,
    ],
  );
  persist();
}

export function getDuePendingEvents(
  limit = 25,
  options: { force?: boolean } = {},
) {
  const ignoreNextAttempt = options.force === true;
  return rows<PendingEvent>(
    `select id, method, endpoint, payload_json as payloadJson, attempts
     from pending_events
     where status in ('pending', 'failed')${ignoreNextAttempt ? '' : ' and next_attempt_at <= ?'}
     order by created_at asc, rowid asc
     limit ?`,
    ignoreNextAttempt ? [limit] : [new Date().toISOString(), limit],
  );
}

export function markPendingEventUploaded(id: string) {
  database?.run(`update pending_events set status = 'uploaded', updated_at = ? where id = ?`, [
    new Date().toISOString(),
    id,
  ]);
  persist();
}

export function markPendingEventFailed(id: string, attempts: number) {
  const nextAttempts = attempts + 1;
  database?.run(
    `update pending_events
     set status = 'failed', attempts = ?, next_attempt_at = ?, updated_at = ?
     where id = ?`,
    [nextAttempts, nextAttemptAt(nextAttempts), new Date().toISOString(), id],
  );
  persist();
}

export function markPendingEventPermanentlyRejected(id: string, attempts: number) {
  database?.run(
    `update pending_events
     set status = 'dead', attempts = ?, updated_at = ?
     where id = ?`,
    [attempts + 1, new Date().toISOString(), id],
  );
  persist();
}

export function enqueuePendingScreenshot(options: {
  screenshotId: string;
  metadata: Record<string, unknown>;
  filePath: string;
}) {
  if (!database) {
    return;
  }
  const now = new Date().toISOString();
  database.run(
    `insert or replace into pending_screenshots
      (screenshot_id, metadata_json, file_path, status, attempts, next_attempt_at, created_at, updated_at)
     values (?, ?, ?, 'pending', 0, ?, ?, ?)`,
    [options.screenshotId, JSON.stringify(options.metadata), options.filePath, now, now, now],
  );
  persist();
}

export function getDuePendingScreenshots(
  limit = 10,
  options: { force?: boolean } = {},
) {
  const ignoreNextAttempt = options.force === true;
  return rows<PendingScreenshot>(
    `select screenshot_id as screenshotId, metadata_json as metadataJson, file_path as filePath, attempts
     from pending_screenshots
     where status in ('pending', 'failed')${ignoreNextAttempt ? '' : ' and next_attempt_at <= ?'}
     order by created_at asc
     limit ?`,
    ignoreNextAttempt ? [limit] : [new Date().toISOString(), limit],
  );
}

export function markPendingScreenshotUploaded(screenshotId: string) {
  database?.run(`update pending_screenshots set status = 'uploaded', updated_at = ? where screenshot_id = ?`, [
    new Date().toISOString(),
    screenshotId,
  ]);
  persist();
}

export function markPendingScreenshotFailed(
  screenshotId: string,
  attempts: number,
  permanentlyRejected = false,
) {
  const nextAttempts = attempts + 1;
  const status = permanentlyRejected ? 'dead' : 'failed';
  database?.run(
    `update pending_screenshots
     set status = ?, attempts = ?, next_attempt_at = ?, updated_at = ?
     where screenshot_id = ?`,
    [status, nextAttempts, nextAttemptAt(nextAttempts), new Date().toISOString(), screenshotId],
  );
  persist();
}
