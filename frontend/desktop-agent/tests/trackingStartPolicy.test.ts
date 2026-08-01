import assert from "node:assert/strict";
import test from "node:test";

import { requiresExplicitExtraTimeStart } from "../electron/services/trackingStartPolicy.ts";

test("a fresh session outside the shift requires employee confirmation", () => {
  assert.equal(
    requiresExplicitExtraTimeStart({
      hasExistingSession: false,
      outsideScheduledShift: true,
      confirmationAccepted: false,
    }),
    true,
  );
});

test("confirmation permits a fresh extra-time session", () => {
  assert.equal(
    requiresExplicitExtraTimeStart({
      hasExistingSession: false,
      outsideScheduledShift: true,
      confirmationAccepted: true,
    }),
    false,
  );
});

test("an existing session continues across the shift boundary", () => {
  assert.equal(
    requiresExplicitExtraTimeStart({
      hasExistingSession: true,
      outsideScheduledShift: true,
      confirmationAccepted: false,
    }),
    false,
  );
});

test("scheduled shift tracking still starts automatically", () => {
  assert.equal(
    requiresExplicitExtraTimeStart({
      hasExistingSession: false,
      outsideScheduledShift: false,
      confirmationAccepted: false,
    }),
    false,
  );
});
