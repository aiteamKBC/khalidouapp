import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageConfiguration = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as {
  build: {
    nsis: {
      oneClick: boolean;
      perMachine: boolean;
      allowElevation: boolean;
      allowToChangeInstallationDirectory: boolean;
    };
  };
};

test("Windows installation remains fixed to the non-elevated per-user scope", () => {
  assert.equal(packageConfiguration.build.nsis.oneClick, true);
  assert.equal(packageConfiguration.build.nsis.perMachine, false);
  assert.equal(packageConfiguration.build.nsis.allowElevation, false);
  assert.equal(
    packageConfiguration.build.nsis.allowToChangeInstallationDirectory,
    false,
  );
});
