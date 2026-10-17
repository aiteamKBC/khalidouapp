// Bring the E2E stack up without running tests (for debugging): node lib/up.ts
import globalSetup from "../global-setup.ts";
await globalSetup();
setTimeout(() => process.exit(0), 100);
console.log("[e2e] stack is up; stop it with: node lib/down.ts");
