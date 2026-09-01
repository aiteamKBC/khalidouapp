import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import { getUserFacingError } from "../electron/services/userFacingError.ts";

test("desktop timeouts use a clear recovery message", () => {
  const error = new axios.AxiosError(
    "timeout of 15000ms exceeded",
    "ECONNABORTED",
  );

  assert.equal(
    getUserFacingError(error, "Fallback"),
    "The server took too long to respond. Please try again when the connection recovers.",
  );
});

test("API messages remain more specific than connection fallbacks", () => {
  const error = new axios.AxiosError(
    "Request failed",
    "ERR_BAD_RESPONSE",
    undefined,
    undefined,
    {
      data: { error: { message: "Device access was revoked." } },
      status: 403,
      statusText: "Forbidden",
      headers: {},
      config: { headers: new axios.AxiosHeaders() },
    },
  );

  assert.equal(
    getUserFacingError(error, "Fallback"),
    "Device access was revoked.",
  );
});
