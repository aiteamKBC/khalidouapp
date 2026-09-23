import electronMain from 'electron/main';
import initSqlJs, { type Database } from 'sql.js';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { orderedDuePendingEvents } from './pendingEventOrdering.js';

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
  // Write to a temp file, flush it to disk, then atomically rename over the
  // real database. fs.writeFileSync truncates the target first, so an
  // interrupted write (power loss, forced kill) would leave offline.sqlite
  // half-written and unreadable on next launch. Rename on the same volume is
  // atomic, so the on-disk database is always a complete, previously-valid
  // snapshot — never a partial one.
  const target = dbPath();
  const temporary = `${target}.tmp`;
  const data = Buffer.from(database.export());
  const handle = fs.openSync(temporary, 'w');
  try {
    fs.writeSync(handle, data);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, target);
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
  // A crash during persist() can leave a stale temp file behind. It is never
  // the source of truth, so discard it before loading the real database.
  const temporaryPath = `${filePath}.tmp`;
  if (fs.existsSync(temporaryPath)) {
    try {
      fs.rmSync(temporaryPath);
    } catch (error) {
      log.warn('Could not remove stale offline database temp file', error);
    }
  }
  if (fs.existsSync(filePath)) {
    try {
      database = new SQL.Database(fs.readFileSync(filePath));
      // sql.js does not validate the image on construction — a corrupt file
      // (e.g. a half-written one from a pre-atomic build interrupted by power
      // loss) only fails on first access. Force a read of the schema page now
      // so corruption is detected and recovered here, instead of throwing a
      // few lines below during table setup and bricking startup.
      database.exec('select count(*) from sqlite_master');
    } catch (error) {
      // Discard the unreadable handle, quarantine the file for diagnostics,
      // and start fresh so the agent still boots and can resume tracking.
      try {
        database?.close();
      } catch {
        // Nothing actionable if the corrupt handle cannot be closed.
      }
      database = null;
      const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(filePath, quarantinePath);
        log.error(
          `Offline database was corrupt; quarantined to ${quarantinePath} and reinitialized.`,
          error,
        );
      } catch (renameError) {
        log.error(
          'Offline database was corrupt and could not be quarantined; reinitializing.',
          renameError,
        );
      }
      database = new SQL.Database();
    }
  } else {
    database = new SQL.Database();
  }

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
  // Durable recovery baseline: the server session's counters captured the FIRST
  // time this local session was promoted. Reusing it on every retry (instead of
  // re-reading the live server counters, which already include a previous
  // attempt) makes offline recovery idempotent — the backend heartbeat is
  // monotonic/absolute, so submitting baseline+local repeatedly converges.
  ensureColumn("local_sessions", "recovery_baseline_active", "integer");
  ensureColumn("local_sessions", "recovery_baseline_idle", "integer");
  ensureColumn("local_sessions", "server_session_id", "text");
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

export function getRecoveryBaseline(
  sessionId: string,
): { activeSeconds: number; idleSeconds: number } | null {
  const row = rows<{
    recovery_baseline_active: number | null;
    recovery_baseline_idle: number | null;
  }>(
    `select recovery_baseline_active, recovery_baseline_idle
     from local_sessions where session_id = ? limit 1`,
    [sessionId],
  )[0];
  if (
    !row ||
    row.recovery_baseline_active === null ||
    row.recovery_baseline_active === undefined
  ) {
    return null;
  }
  return {
    activeSeconds: Math.max(0, Math.floor(row.recovery_baseline_active)),
    idleSeconds: Math.max(0, Math.floor(row.recovery_baseline_idle ?? 0)),
  };
}

export function setRecoveryBaseline(
  sessionId: string,
  baseline: { activeSeconds: number; idleSeconds: number },
) {
  if (!database) return;
  // Set once, and only for a not-yet-synced row. `where recovery_baseline_active
  // is null` makes this a no-op on a concurrent/second call, so the first
  // captured baseline is authoritative for all retries.
  database.run(
    `update local_sessions
     set recovery_baseline_active = ?, recovery_baseline_idle = ?
     where session_id = ? and recovery_baseline_active is null`,
    [
      Math.max(0, Math.floor(baseline.activeSeconds)),
      Math.max(0, Math.floor(baseline.idleSeconds)),
      sessionId,
    ],
  );
  persist();
}

export function getServerSessionIdForLocalSession(
  localSessionId: string,
): string | null {
  return (
    rows<{ server_session_id: string | null }>(
      `select server_session_id from local_sessions
       where session_id = ? limit 1`,
      [localSessionId],
    )[0]?.server_session_id ?? null
  );
}

export function markLocalTrackingSessionSynced(
  sessionId: string,
  syncedAt = new Date().toISOString(),
  serverSessionId: string | null = null,
) {
  if (!database) return;
  database.run(
    `update local_sessions set synced_at = ?, server_session_id = ?
     where session_id = ?`,
    [syncedAt, serverSessionId, sessionId],
  );
  // Keep the row (with its server_session_id mapping) so a delayed offline
  // screenshot can still resolve its recovered server session; only the replayed
  // events are no longer needed.
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
  // Optional ordering override. Events deliver in `created_at asc, rowid asc`
  // order within a session group (see getDuePendingEvents / orderedDuePendingEvents).
  // A durable finalization End is enqueued BEFORE its in-flight predecessors are
  // awaited (so it survives a kill during the wait), but it must still deliver
  // AFTER them. Passing a sentinel far-future createdAt makes it sort last within
  // its session group regardless of when a predecessor's failure row is inserted,
  // so a kill-then-restart replays predecessor evidence first and End last (O1).
  createdAt?: string;
}) {
  if (!database) {
    return;
  }
  const now = new Date().toISOString();
  const createdAt = options.createdAt ?? now;
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
      createdAt,
      now,
    ],
  );
  persist();
}

export function getDuePendingEvents(
  limit = 25,
  options: { force?: boolean } = {},
): PendingEvent[] {
  // Fetch the whole ordered chain (no backoff filter in SQL) and let the
  // ordering policy decide what is deliverable, so a backed-off predecessor
  // blocks its session's later events instead of being skipped past. Ordering
  // by created_at then rowid gives a stable causal order per session.
  const ordered = rows<PendingEvent & { endpoint: string; nextAttemptAt: string }>(
    `select id, method, endpoint, payload_json as payloadJson, attempts,
            next_attempt_at as nextAttemptAt
     from pending_events
     where status in ('pending', 'failed')
     order by created_at asc, rowid asc`,
  );
  return orderedDuePendingEvents(ordered, {
    now: Date.now(),
    force: options.force === true,
    limit,
  }).map(({ id, method, endpoint, payloadJson, attempts }) => ({
    id,
    method,
    endpoint,
    payloadJson,
    attempts,
  }));
}

export function hasPendingEventsForSession(
  serverSessionId: string,
  exceptId?: string,
): boolean {
  // Any still-undelivered (pending or backed-off 'failed') event whose endpoint
  // targets this session. Used so a direct End does not overtake a queued
  // predecessor (e.g. a backed-off Pause) for the same session and close it
  // before the predecessor is delivered. Session ids are UUIDs, so they contain
  // no SQL LIKE wildcards.
  //
  // `exceptId` excludes one row from the count. The durable finalization End is
  // enqueued up front (so it survives a kill during predecessor waits, O1); when
  // later deciding whether End can be sent DIRECTLY, its own queued row must not
  // count as a blocking predecessor.
  const query = exceptId
    ? `select count(*) as n from pending_events
       where status in ('pending', 'failed')
         and endpoint like ? and id <> ?`
    : `select count(*) as n from pending_events
       where status in ('pending', 'failed')
         and endpoint like ?`;
  const params = exceptId
    ? [`/agent/sessions/${serverSessionId}/%`, exceptId]
    : [`/agent/sessions/${serverSessionId}/%`];
  return (rows<{ n: number }>(query, params)[0]?.n ?? 0) > 0;
}

export function markPendingEventUploaded(id: string) {
  // A synced event is never re-read, so delete it rather than leaving an
  // 'uploaded' row behind. persist() rewrites the whole database file on every
  // mutation, so retained terminal rows would make each write progressively
  // more expensive without bound.
  database?.run(`delete from pending_events where id = ?`, [id]);
  persist();
}

export function markPendingEventIgnored(id: string) {
  // The server accepted but IGNORED this event (e.g. it reached an already-closed
  // session). Its payload may hold work that was never applied, so it must not be
  // silently deleted. Move it to a terminal 'ignored' state instead: it is not
  // re-read by getDuePendingEvents (so it is never retried in a futile loop) and
  // NOT removed by purgeTerminalPendingEvents (which only clears 'uploaded'/'dead'),
  // so the full payload is durably retained for later reconciliation.
  database?.run(
    `update pending_events
     set status = 'ignored', updated_at = ?
     where id = ?`,
    [new Date().toISOString(), id],
  );
  persist();
}

export function listIgnoredPendingEvents(): Array<{
  id: string;
  endpoint: string;
  payloadJson: string;
}> {
  // Ignored events retained for reconciliation (see markPendingEventIgnored).
  return rows<{ id: string; endpoint: string; payloadJson: string }>(
    `select id, endpoint, payload_json as payloadJson
     from pending_events
     where status = 'ignored'
     order by created_at asc, rowid asc`,
  );
}

export function listPendingMeetingEvents(): Array<{
  id: string;
  endpoint: string;
  payloadJson: string;
}> {
  // Legacy Meeting Mode delivered start/end through this generic outbox. Meetings
  // now use a dedicated durable store + sync, so on upgrade we import any
  // still-undelivered meeting rows into that store and neutralize them here
  // (see markPendingEventIgnored) instead of re-POSTing blindly. Terminal rows
  // ('uploaded' are already deleted; 'dead'/'ignored' are excluded) are skipped.
  return rows<{ id: string; endpoint: string; payloadJson: string }>(
    `select id, endpoint, payload_json as payloadJson
     from pending_events
     where status in ('pending', 'failed')
       and endpoint in ('/agent/meetings', '/agent/meetings/end')
     order by created_at asc, rowid asc`,
  );
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
  // Move the row to a terminal 'uploaded' state instead of deleting it here, so
  // the owned JPEG is removed BEFORE its queue row disappears. Deleting the row
  // first and then removing the file is unsafe: if the delete fails (EPERM / file
  // in use) the file is orphaned with no record to drive a retry. The trailing
  // cleanup pass removes the file and only then purges the terminal row, and it
  // retains rows whose file could not be removed. 'uploaded' rows are excluded
  // from getDuePendingScreenshots, so the image is never re-uploaded.
  database?.run(
    `update pending_screenshots
     set status = 'uploaded', updated_at = ?
     where screenshot_id = ?`,
    [new Date().toISOString(), screenshotId],
  );
  persist();
}

export function listTerminalPendingScreenshots(): Array<{
  screenshotId: string;
  filePath: string;
}> {
  // Screenshots in a terminal state ('dead' = permanently rejected, 'uploaded'
  // = legacy synced rows). Their files must be removed before the rows are
  // purged, otherwise a JPEG is orphaned on disk with no queue record. Returned
  // so the caller — which owns the pending-screenshot directory — can delete
  // only application-owned files. Restart-safe: any dead row whose file removal
  // was interrupted is returned again on the next pass.
  return rows<{ screenshotId: string; filePath: string }>(
    `select screenshot_id as screenshotId, file_path as filePath
     from pending_screenshots
     where status in ('uploaded', 'dead')`,
  );
}

export function purgeTerminalPendingEvents() {
  // Remove pending_events left in a terminal state ('uploaded' rows written by
  // older builds, 'dead' rows for permanently-rejected items). These are never
  // re-read; deleting them keeps the database bounded by in-flight work.
  if (!database) {
    return;
  }
  database.run(`delete from pending_events where status in ('uploaded', 'dead')`);
  if (database.getRowsModified() > 0) {
    persist();
  }
}

export function purgeTerminalScreenshotRows(screenshotIds: string[]) {
  // Delete ONLY the specific terminal screenshot rows whose owned file the caller
  // has confirmed removed (or was never present). A terminal row whose file could
  // not be deleted is deliberately NOT passed here, so it survives for a later
  // retry instead of leaving an orphaned JPEG with no queue record.
  if (!database || screenshotIds.length === 0) {
    return;
  }
  const placeholders = screenshotIds.map(() => "?").join(", ");
  database.run(
    `delete from pending_screenshots
     where status in ('uploaded', 'dead')
       and screenshot_id in (${placeholders})`,
    screenshotIds,
  );
  if (database.getRowsModified() > 0) {
    persist();
  }
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
