import assert from "node:assert/strict";
import test from "node:test";

import {
  idleRequestKeyForIdleStart,
  requestableIdleMinutes,
  totalRequestableIdleMinutes,
} from "../src/idleRequests.ts";

test("a 10:28 idle period permits a maximum request of 10 whole minutes", () => {
  assert.equal(requestableIdleMinutes({ availableSeconds: 10 * 60 + 28 }), 10);
});

test("idle periods shorter than one minute are not requestable", () => {
  assert.equal(requestableIdleMinutes({ availableSeconds: 18 }), 0);
  assert.equal(requestableIdleMinutes({ availableSeconds: 56 }), 0);
  assert.equal(requestableIdleMinutes({ availableSeconds: 59 }), 0);
  assert.equal(requestableIdleMinutes({ availableSeconds: 60 }), 1);
});

test("the screenshot example keeps total idle separate from requestable minutes", () => {
  const periods = [10 * 60 + 28, 56, 18, 37].map((availableSeconds) => ({
    availableSeconds,
  }));

  assert.equal(
    periods.reduce((total, period) => total + period.availableSeconds, 0),
    12 * 60 + 19,
  );
  assert.equal(totalRequestableIdleMinutes(periods), 10);
});

test("partial minutes cannot be combined across separate idle periods", () => {
  assert.equal(
    totalRequestableIdleMinutes([
      { availableSeconds: 90 },
      { availableSeconds: 119 },
    ]),
    2,
  );
});

test("the idle popup's period is the latest requestable one after idle began", () => {
  const idleStart = Date.parse("2026-09-26T09:00:00Z");
  const periods = [
    // An earlier idle period today must not be picked.
    { work_session_id: "s", started_at: "2026-09-26T07:00:00Z", ended_at: "2026-09-26T07:20:00Z", available_seconds: 1200 },
    { work_session_id: "s", started_at: "2026-09-26T09:00:01Z", ended_at: "2026-09-26T09:12:00Z", available_seconds: 719 },
  ];
  assert.equal(
    idleRequestKeyForIdleStart(periods, idleStart),
    "s|2026-09-26T09:00:01Z|2026-09-26T09:12:00Z",
  );
});

test("no period is returned before it syncs or when it is under a minute", () => {
  const idleStart = Date.parse("2026-09-26T09:00:00Z");
  assert.equal(idleRequestKeyForIdleStart([], idleStart), null);
  assert.equal(
    idleRequestKeyForIdleStart(
      [{ work_session_id: "s", started_at: "2026-09-26T09:00:00Z", ended_at: "2026-09-26T09:00:40Z", available_seconds: 40 }],
      idleStart,
    ),
    null,
  );
});
