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
  persist();
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

export function getDuePendingEvents(limit = 25) {
  return rows<PendingEvent>(
    `select id, method, endpoint, payload_json as payloadJson, attempts
     from pending_events
     where status in ('pending', 'failed') and next_attempt_at <= ?
     order by created_at asc
     limit ?`,
    [new Date().toISOString(), limit],
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
  database?.run(
    `update pending_events
     set status = 'failed', attempts = ?, next_attempt_at = ?, updated_at = ?
     where id = ?`,
    [attempts + 1, nextAttemptAt(attempts + 1), new Date().toISOString(), id],
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

export function getDuePendingScreenshots(limit = 10) {
  return rows<PendingScreenshot>(
    `select screenshot_id as screenshotId, metadata_json as metadataJson, file_path as filePath, attempts
     from pending_screenshots
     where status in ('pending', 'failed') and next_attempt_at <= ?
     order by created_at asc
     limit ?`,
    [new Date().toISOString(), limit],
  );
}

export function markPendingScreenshotUploaded(screenshotId: string) {
  database?.run(`update pending_screenshots set status = 'uploaded', updated_at = ? where screenshot_id = ?`, [
    new Date().toISOString(),
    screenshotId,
  ]);
  persist();
}

export function markPendingScreenshotFailed(screenshotId: string, attempts: number) {
  database?.run(
    `update pending_screenshots
     set status = 'failed', attempts = ?, next_attempt_at = ?, updated_at = ?
     where screenshot_id = ?`,
    [attempts + 1, nextAttemptAt(attempts + 1), new Date().toISOString(), screenshotId],
  );
  persist();
}
