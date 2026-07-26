import assert from "node:assert/strict";
import test from "node:test";

import {
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
