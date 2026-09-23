import assert from "node:assert/strict";
import test from "node:test";

import {
  desiredStartupCommand,
  findLegacyInstall,
  legacyCleanupScript,
  legacyInstallDirectories,
  parseRunValue,
  startupEntryNeedsRepair,
} from "../electron/services/legacyInstall.ts";

const perUser = "C:\\Users\\emp\\AppData\\Local\\Programs\\khaliduo\\Khaliduo.exe";
const env = {
  ProgramFiles: "C:\\Program Files",
  ProgramW6432: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
};

test("legacy directories are de-duplicated", () => {
  assert.deepEqual(legacyInstallDirectories(env), [
    "C:\\Program Files\\Khaliduo",
    "C:\\Program Files (x86)\\Khaliduo",
  ]);
});

test("finds the old per-machine copy next to a per-user install", () => {
  const present = new Set([
    "C:\\Program Files\\Khaliduo\\Khaliduo.exe",
    "C:\\Program Files\\Khaliduo\\Uninstall Khaliduo.exe",
  ]);
  const legacy = findLegacyInstall(perUser, legacyInstallDirectories(env), (p) => present.has(p));
  assert.equal(legacy?.uninstaller, "C:\\Program Files\\Khaliduo\\Uninstall Khaliduo.exe");
});

test("never treats the running executable as the legacy copy", () => {
  const running = "C:\\Program Files\\Khaliduo\\Khaliduo.exe";
  const legacy = findLegacyInstall(running, legacyInstallDirectories(env), () => true);
  assert.equal(legacy?.directory, "C:\\Program Files (x86)\\Khaliduo");
  assert.equal(findLegacyInstall(running, ["C:\\Program Files\\Khaliduo"], () => true), null);
});

test("no legacy copy when Program Files has nothing", () => {
  assert.equal(findLegacyInstall(perUser, legacyInstallDirectories(env), () => false), null);
});

test("parses the Run value written by the old copy and flags it for repair", () => {
  const output = [
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    '    Khaliduo    REG_SZ    "C:\\Program Files\\Khaliduo\\Khaliduo.exe" --autostart',
    "",
  ].join("\r\n");
  const current = parseRunValue(output);
  assert.equal(current, '"C:\\Program Files\\Khaliduo\\Khaliduo.exe" --autostart');
  assert.equal(startupEntryNeedsRepair(current, perUser), true);
});

test("an entry already pointing here (any case) needs no repair", () => {
  const current = desiredStartupCommand(perUser.toUpperCase());
  assert.equal(startupEntryNeedsRepair(current, perUser), false);
  assert.equal(startupEntryNeedsRepair(null, perUser), true);
});

test("cleanup script elevates the silent all-users uninstall and relaunches", () => {
  const script = legacyCleanupScript(
    {
      directory: "C:\\Program Files\\Khaliduo",
      executable: "C:\\Program Files\\Khaliduo\\Khaliduo.exe",
      uninstaller: "C:\\Program Files\\Khaliduo\\Uninstall Khaliduo.exe",
    },
    "C:\\Users\\o'brien\\AppData\\Local\\Programs\\khaliduo\\Khaliduo.exe",
  );
  assert.match(script, /-ArgumentList '\/allusers','\/S' -Verb RunAs -Wait/);
  assert.match(script, /o''brien/);
  assert.match(script, /--autostart/);
});
