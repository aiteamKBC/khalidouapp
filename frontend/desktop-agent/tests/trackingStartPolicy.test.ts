import assert from "node:assert/strict";
import test from "node:test";

import { requiresExplicitFreshSessionStart } from "../electron/services/trackingStartPolicy.ts";

test("a fresh session outside the shift requires employee confirmation", () => {
  assert.equal(
    requiresExplicitFreshSessionStart({
      hasExistingSession: false,
      confirmationAccepted: false,
    }),
    true,
  );
});

test("confirmation permits a fresh extra-time session", () => {
  assert.equal(
    requiresExplicitFreshSessionStart({
      hasExistingSession: false,
      confirmationAccepted: true,
    }),
    false,
  );
});

test("an existing session continues across the shift boundary", () => {
  assert.equal(
    requiresExplicitFreshSessionStart({
      hasExistingSession: true,
      confirmationAccepted: false,
    }),
    false,
  );
});

test("a fresh scheduled-shift session also requires presence confirmation", () => {
  assert.equal(
    requiresExplicitFreshSessionStart({
      hasExistingSession: false,
      confirmationAccepted: false,
    }),
    true,
  );
});
