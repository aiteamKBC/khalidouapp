import test from "node:test";
import assert from "node:assert/strict";
import { AppearanceStore, type Appearance } from "../../shared/appearance-store.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function environment() {
  const records = new Map<string, string>();
  Object.assign(globalThis, {
    window: new EventTarget(),
    localStorage: { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); } },
  });
  return records;
}

test("dashboard and desktop converge while preserving separate palette/mode edits", async () => {
  environment();
  let remote: Appearance = { skin: "orbit", mode: "dark" };
  const transport = { read: async () => remote, write: async (patch: Partial<Appearance>) => remote = { ...remote, ...patch } };
  const desktop = new AppearanceStore("company:employee", transport);
  const dashboard = new AppearanceStore("company:employee", transport);
  const stop = [desktop.start(), dashboard.start()];
  try {
    await tick();
    desktop.update({ skin: "forest" }); await tick(); await dashboard.sync();
    assert.deepEqual(dashboard.snapshot(), { skin: "forest", mode: "dark" });
    dashboard.update({ mode: "light" }); await tick(); await desktop.sync();
    assert.deepEqual(desktop.snapshot(), { skin: "forest", mode: "light" });
  } finally { stop.forEach(fn => fn()); }
});

test("late reads cannot revert a newer choice", async () => {
  environment();
  let resolveRead!: (value: Appearance) => void;
  const store = new AppearanceStore("company:employee", {
    read: () => new Promise(resolve => { resolveRead = resolve; }),
    write: async patch => ({ skin: "orbit", mode: "dark", ...patch }),
  });
  const stop = store.start();
  try {
    store.update({ skin: "forest" }); await tick();
    resolveRead({ skin: "ember", mode: "light" }); await tick();
    assert.deepEqual(store.snapshot(), { skin: "forest", mode: "dark" });
  } finally { stop(); }
});

test("offline choices survive restarting and are uploaded when connectivity returns", async () => {
  environment();
  const offline = new AppearanceStore("company:employee", { read: async () => { throw Error("offline"); }, write: async () => { throw Error("offline"); } });
  const stopOffline = offline.start();
  offline.update({ skin: "ember", mode: "light" }); await tick(); stopOffline();
  let remote: Appearance = { skin: "orbit", mode: "dark" };
  const restarted = new AppearanceStore("company:employee", { read: async () => remote, write: async patch => remote = { ...remote, ...patch } });
  const stop = restarted.start();
  try {
    await tick();
    assert.deepEqual(remote, { skin: "ember", mode: "light" });
    assert.deepEqual(restarted.snapshot(), remote);
  } finally { stop(); }
});

test("pending edits and in-flight writes remain durable during rapid changes", async () => {
  const records = environment();
  let resolveWrite!: (value: Appearance) => void;
  let count = 0;
  const store = new AppearanceStore("company:employee", {
    read: async () => ({ skin: "orbit", mode: "dark" }),
    write: async patch => ++count === 1 ? new Promise(resolve => { resolveWrite = resolve; }) : ({ skin: "orbit", mode: "light", ...patch }),
  });
  const stop = store.start();
  try {
    await tick();
    store.update({ mode: "light" }); store.update({ skin: "forest" });
    const cache = JSON.parse(records.get("khaliduo-appearance-v1:company:employee")!);
    assert.deepEqual(cache.pending, { mode: "light", skin: "forest" });
    resolveWrite({ skin: "orbit", mode: "light" }); await tick();
    assert.deepEqual(store.snapshot(), { skin: "forest", mode: "light" });
  } finally { stop(); }
});

test("switching accounts never restores another employee's cached preference", async () => {
  environment();
  const first = new AppearanceStore("company:first", { read: async () => null, write: async patch => ({ skin: "orbit", mode: "dark", ...patch }) });
  const stopFirst = first.start(); first.update({ skin: "forest" }); await tick(); stopFirst();
  const second = new AppearanceStore("company:second", { read: async () => null, write: async () => { throw Error("unexpected write"); } });
  const stopSecond = second.start();
  try { await tick(); assert.deepEqual(second.snapshot(), { skin: "orbit", mode: "dark" }); }
  finally { stopSecond(); }
});

test("legacy choices migrate after an offline restart without overwriting an existing account preference", async () => {
  const records = environment();
  records.set("khaliduo-app-skin-v4", "forest"); records.set("khaliduo-theme", "light");
  const offline = new AppearanceStore("company:employee", { read: async () => { throw Error("offline"); }, write: async () => { throw Error("offline"); } });
  const stopOffline = offline.start(); await tick(); stopOffline();
  let remote: Appearance | null = null;
  const restored = new AppearanceStore("company:employee", { read: async () => remote, write: async patch => remote = { skin: "orbit", mode: "dark", ...patch } });
  const stop = restored.start();
  await tick();
  assert.deepEqual(remote, { skin: "forest", mode: "light" }); stop();
  records.delete("khaliduo-appearance-v1:company:employee"); records.delete("khaliduo-appearance-legacy-owner");
  remote = { skin: "ember", mode: "dark" };
  let writes = 0;
  const current = new AppearanceStore("company:employee", { read: async () => remote, write: async () => { writes++; return remote; } });
  const stopCurrent = current.start();
  try { await tick(); assert.deepEqual(current.snapshot(), remote); assert.equal(writes, 0); }
  finally { stopCurrent(); }
});
