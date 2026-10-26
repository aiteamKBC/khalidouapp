import test from "node:test";
import assert from "node:assert/strict";
import { createStatusReader } from "../src/statusReader.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("slow native status requests cannot accumulate behind the polling interval", async () => {
  const pending = deferred<string>();
  let reads = 0;
  const received: string[] = [];
  const reader = createStatusReader(() => { reads++; return pending.promise; }, value => received.push(value));
  const first = reader.poll();
  await Promise.all(Array.from({ length: 100 }, () => reader.poll()));
  assert.equal(reads, 1);
  pending.resolve("active");
  await first;
  assert.deepEqual(received, ["active"]);
});

test("an older snapshot cannot undo Resume, End Shift or sign-out events", async () => {
  const pending = deferred<string>();
  const received: string[] = [];
  const reader = createStatusReader(() => pending.promise, value => received.push(value));
  const poll = reader.poll();
  reader.push("signed-out");
  pending.resolve("old-employee-active");
  await poll;
  assert.deepEqual(received, ["signed-out"]);
});

test("polling recovers after an IPC rejection without an unhandled failure", async () => {
  let reads = 0;
  const received: string[] = [];
  const reader = createStatusReader(async () => {
    if (++reads === 1) throw Error("IPC unavailable");
    return "recovered";
  }, value => received.push(value));
  await reader.poll();
  await reader.poll();
  assert.deepEqual(received, ["recovered"]);
});

test("unmounting blocks late snapshots and native events", async () => {
  const pending = deferred<string>();
  const received: string[] = [];
  const reader = createStatusReader(() => pending.promise, value => received.push(value));
  const poll = reader.poll();
  reader.stop();
  pending.resolve("late");
  reader.push("also-late");
  await poll;
  await reader.poll();
  assert.deepEqual(received, []);
});
