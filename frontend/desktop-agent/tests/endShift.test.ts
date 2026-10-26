import assert from "node:assert/strict";
import test from "node:test";
import { context, functions } from "./support/mainHarness.ts";

test("End Shift awaits durable session finalization before publishing the new status", async () => {
  const events: string[] = [];
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const c = context({
    isSigningOut: false,
    isQuitting: false,
    stopTrackingSession: async (reason: string) => {
      events.push(reason);
      await pending;
      return { success: true };
    },
    notifyRendererStatus: () => events.push("published"),
  });
  functions(c, "endShift");
  const result = c.endShift();
  assert.deepEqual(events, ["Employee ended shift"]);
  finish();
  assert.equal((await result).success, true);
  assert.deepEqual(events, ["Employee ended shift", "published"]);
});

for (const scenario of ["unenrolled", "signing-out", "quitting"]) {
  test(`End Shift leaves session state alone when ${scenario}`, async () => {
    let calls = 0;
    const c = context({
      runtimeStatus: { enrolled: scenario !== "unenrolled" },
      isSigningOut: scenario === "signing-out",
      isQuitting: scenario === "quitting",
      stopTrackingSession: async () => {
        calls++;
        return { success: true };
      },
      notifyRendererStatus: () => {
        calls++;
      },
    });
    functions(c, "endShift");
    assert.equal((await c.endShift()).success, false);
    assert.equal(calls, 0);
  });
}
