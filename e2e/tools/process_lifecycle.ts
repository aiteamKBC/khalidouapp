// Exercise actual process ownership without touching any employee's application.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { PIDS_FILE } from '../lib/env.ts';
import { killRecorded, windowsProcessStartTime } from '../lib/stack.ts';

if (process.platform !== 'win32') throw new Error('This check requires Windows');
if (fs.existsSync(PIDS_FILE)) throw new Error('Stop the isolated stack before this lifecycle check');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
const began = windowsProcessStartTime(child.pid!);
assert.ok(began);
try {
  fs.writeFileSync(PIDS_FILE, JSON.stringify({ probe: { pid: child.pid, startedAt: '0' } }));
  killRecorded();
  process.kill(child.pid!, 0);
  console.log('PASS: a reused PID identity is preserved');
  fs.writeFileSync(PIDS_FILE, JSON.stringify({ probe: { pid: child.pid, startedAt: began } }));
  killRecorded();
  assert.equal(windowsProcessStartTime(child.pid!), '');
  assert.equal(fs.existsSync(PIDS_FILE), false);
  console.log('PASS: the matching owned process is stopped and the manifest retired');
} finally {
  if (windowsProcessStartTime(child.pid!) === began) {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
  }
}
