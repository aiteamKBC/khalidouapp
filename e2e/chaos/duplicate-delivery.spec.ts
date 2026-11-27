import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { ApiError, asAdmin, headlessAgent } from "../fixtures/api.ts";

for (const kind of ["heartbeat", "event"] as const) test(`concurrent redelivery of one ${kind} creates exactly one ledger event`, async () => {
  const agent = await headlessAgent("other");
  const admin = await asAdmin("super");
  const started = await agent.start();
  const sessionId = started.session.id;
  const eventId = crypto.randomUUID();
  const payload = kind === "heartbeat"
    ? { event_id: eventId, timestamp: new Date().toISOString(), status: "active", active_seconds: 0, idle_seconds: 0, agent_version: "9.9.9" }
    : { event_id: eventId, event_timestamp: new Date().toISOString(), event_type: "idle_started", payload: { idle_seconds: 0, repro_event_id: eventId } };
  const send = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await agent.call("POST", `/sessions/${sessionId}/${kind === "heartbeat" ? "heartbeat" : "events"}`, payload); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 429 || attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  };
  const replies = await Promise.allSettled(Array.from({ length: 12 }, send));
  expect(replies.filter(r => r.status === "rejected").map(r => String(r.reason))).toEqual([]);
  const values = replies.filter(r => r.status === "fulfilled").map(r => r.value);
  expect(values.filter(v => v.duplicate === false)).toHaveLength(1);
  expect(values.every(v => v.session.id === sessionId)).toBe(true);
  const response = await admin.get<any>(`/sessions/${sessionId}/events`);
  const events = Array.isArray(response) ? response : response.items ?? response.events;
  expect(events.filter((e: any) => e.idempotency_key === eventId || e.payload?.event_id === eventId || e.payload?.repro_event_id === eventId)).toHaveLength(1);
});
