import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveTrustedIdleSeconds,
  hasSustainedTrustedActivity,
  parseProbeReport,
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

test("one isolated real input report does not grant another idle grace period", () => {
  assert.equal(hasSustainedTrustedActivity([600_000], 600_000), false);
  assert.equal(
    hasSustainedTrustedActivity([599_000, 600_000], 600_000),
    false,
  );
});

test("sustained real activity across probe reports confirms a return", () => {
  assert.equal(
    hasSustainedTrustedActivity([600_000, 600_750, 601_000], 601_000),
    false,
  );
  assert.equal(
    hasSustainedTrustedActivity([600_000, 601_000, 602_000], 602_000),
    true,
  );
  assert.equal(
    hasSustainedTrustedActivity([580_000, 581_000, 600_000], 600_000),
    false,
  );
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
