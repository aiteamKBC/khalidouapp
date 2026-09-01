import assert from "node:assert/strict";
import test from "node:test";

import {
  isWhatsAppScreenshotActivity,
  privacyBlurSampleSize,
} from "../electron/services/screenshotPrivacy.ts";

test("WhatsApp desktop and web activity always require screenshot privacy protection", () => {
  assert.equal(isWhatsAppScreenshotActivity({ processName: "WhatsApp.exe" }), true);
  assert.equal(isWhatsAppScreenshotActivity({ applicationName: "WhatsApp Beta" }), true);
  assert.equal(
    isWhatsAppScreenshotActivity({
      processName: "chrome.exe",
      siteDomain: "web.whatsapp.com",
    }),
    true,
  );
});

test("unrelated applications are not blurred", () => {
  assert.equal(
    isWhatsAppScreenshotActivity({
      processName: "Code.exe",
      applicationName: "Visual Studio Code",
    }),
    false,
  );
});

test("privacy protection uses a tiny aspect-ratio-preserving sample", () => {
  assert.deepEqual(privacyBlurSampleSize(1920, 1080), { width: 48, height: 27 });
});
