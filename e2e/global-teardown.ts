import { killRecorded, killStrayServers, stopDatabase } from "./lib/stack.ts";

export default async function globalTeardown() {
  if (process.env.E2E_REUSE_STACK === "1") return;
  killRecorded();
  killStrayServers();
  stopDatabase();
}
