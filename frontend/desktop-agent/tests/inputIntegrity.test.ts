import assert from "node:assert/strict";
import test from "node:test";

import {
  PROBE_BLIND_AFTER_MS,
  effectiveTrustedIdleSeconds,
  hasRealInput,
  parseProbeReport,
  probeMissedInput,
} from "../electron/services/inputIntegrity.ts";

test("injected input cannot reset trusted idle time", () => {
  assert.equal(
    effectiveTrustedIdleSeconds({
      sensorAvailable: true,
      lastTrustedInputAt: 1_000,
      systemIdleSeconds: 0,
      now: 601_000,
    }),
    600,
  );
});

test("the operating-system idle clock remains the safe fallback", () => {
  assert.equal(
    effectiveTrustedIdleSeconds({
      sensorAvailable: false,
      lastTrustedInputAt: 1_000,
      systemIdleSeconds: 42,
      now: 601_000,
    }),
    42,
  );
});

test("one physical mouse or keyboard report counts as real input", () => {
  assert.equal(hasRealInput({ real_mouse: 1, real_keyboard: 0 }), true);
  assert.equal(hasRealInput({ real_mouse: 0, real_keyboard: 1 }), true);
  assert.equal(hasRealInput({ real_mouse: 0, real_keyboard: 0 }), false);
});

test("the probe parser keeps only bounded aggregate counters", () => {
  assert.deepEqual(
    parseProbeReport(
      '{"real_mouse":7,"real_keyboard":3,"injected_mouse":9,"injected_keyboard":-4}',
    ),
    {
      real_mouse: 7,
      real_keyboard: 3,
      injected_mouse: 9,
      injected_keyboard: 0,
    },
  );
  assert.equal(parseProbeReport("not-json"), null);
});

test("a probe that sees nothing while Windows sees input has gone blind", () => {
  const now = 1_000_000;
  const base = {
    sensorAvailable: true,
    lastProbeEventAt: now - PROBE_BLIND_AFTER_MS,
    probeStartedAt: 0,
    systemIdleSeconds: 0,
    now,
  };
  assert.equal(probeMissedInput(base), true);
  // The employee really is away: Windows saw no input either.
  assert.equal(probeMissedInput({ ...base, systemIdleSeconds: 600 }), false);
  // The probe saw an event recently (real or injected).
  assert.equal(
    probeMissedInput({ ...base, lastProbeEventAt: now - 5_000 }),
    false,
  );
  // A freshly started probe gets the full window before it is judged.
  assert.equal(probeMissedInput({ ...base, probeStartedAt: now - 5_000 }), false);
  // A probe that stopped reporting is already handled by the OS-clock fallback.
  assert.equal(probeMissedInput({ ...base, sensorAvailable: false }), false);
});
