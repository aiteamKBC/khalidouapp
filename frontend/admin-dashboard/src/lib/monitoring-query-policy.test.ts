import assert from "node:assert/strict";
import test from "node:test";
import { keepPreviousData, QueryClient, QueryObserver } from "@tanstack/query-core";

import {
  monitoringDetailEnabled,
  monitoringDetailPolicy,
  monitoringDetailQueryKey,
  monitoringRosterQueryKey,
  monitoringScopeKey,
} from "./monitoring-query-policy.ts";

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for query state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("hidden monitoring sections never enable their data request", () => {
  for (const employeeId of ["employee-a", "employee-b"]) {
    assert.equal(monitoringDetailEnabled(false, employeeId, "2026-07-30"), false);
  }
});

test("attendance waits for an employee selection", () => {
  assert.equal(monitoringDetailEnabled(true, "", "2026-07-30"), false);
  assert.equal(monitoringDetailEnabled(true, "employee-a", "2026-07-30"), true);
});

test("historical detail data is cached without polling", () => {
  assert.deepEqual(monitoringDetailPolicy("2026-07-29", "2026-07-30"), {
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });
  assert.deepEqual(monitoringDetailPolicy("2026-07-30", "2026-07-30"), {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
});

test("monitoring query keys include stable user, team, tab, employee, day, and page inputs", () => {
  const scope = monitoringScopeKey("user-a", ["team-b", "team-a"]);
  assert.equal(scope, "user-a:team-a|team-b");
  assert.deepEqual(monitoringRosterQueryKey("employees", scope), [
    "monitoring",
    "employees",
    "user-a:team-a|team-b",
  ]);
  assert.deepEqual(monitoringDetailQueryKey("screenshots", scope, "employee-a", "2026-07-30", 3), [
    "monitoring",
    "screenshots",
    "user-a:team-a|team-b",
    "employee-a",
    "2026-07-30",
    "screenshots",
    3,
  ]);
});

test("rapid employee switching aborts the obsolete detail request", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const abortedEmployees: string[] = [];
  const queryFn = ({ queryKey, signal }: { queryKey: readonly unknown[]; signal: AbortSignal }) =>
    new Promise<string>((resolve, reject) => {
      const employeeId = String(queryKey[3]);
      const timeout = setTimeout(() => resolve(employeeId), employeeId === "employee-a" ? 200 : 5);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          abortedEmployees.push(employeeId);
          reject(new DOMException("Cancelled", "AbortError"));
        },
        { once: true },
      );
    });
  const scope = monitoringScopeKey("user-a", ["team-a"]);
  const observer = new QueryObserver(client, {
    queryKey: monitoringDetailQueryKey("attendance", scope, "employee-a", "2026-07-30"),
    queryFn,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await waitFor(() => observer.getCurrentResult().fetchStatus === "fetching");
  observer.setOptions({
    queryKey: monitoringDetailQueryKey("attendance", scope, "employee-b", "2026-07-30"),
    queryFn,
  });
  await waitFor(() => observer.getCurrentResult().data === "employee-b");
  assert.deepEqual(abortedEmployees, ["employee-a"]);
  unsubscribe();
  client.clear();
});

test("disabled hidden tabs execute zero requests until activated", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let calls = 0;
  const queryFn = async () => {
    calls += 1;
    return [];
  };
  const scope = monitoringScopeKey("user-a", ["team-a"]);
  const observer = new QueryObserver(client, {
    queryKey: monitoringDetailQueryKey("screenshots", scope, "employee-a", "2026-07-30", 1),
    queryFn,
    enabled: false,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 0);
  observer.setOptions({
    queryKey: monitoringDetailQueryKey("screenshots", scope, "employee-a", "2026-07-30", 1),
    queryFn,
    enabled: true,
  });
  await waitFor(() => observer.getCurrentResult().status === "success");
  assert.equal(calls, 1);
  unsubscribe();
  client.clear();
});

test("cold-loading, empty, and error query states remain distinguishable", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolveCold: ((value: string[]) => void) | undefined;
  const observer = new QueryObserver(client, {
    queryKey: ["monitoring", "state", "cold"],
    queryFn: () =>
      new Promise<string[]>((resolve) => {
        resolveCold = resolve;
      }),
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await waitFor(() => observer.getCurrentResult().fetchStatus === "fetching");
  assert.equal(observer.getCurrentResult().status, "pending");
  assert.equal(observer.getCurrentResult().data, undefined);

  resolveCold?.([]);
  await waitFor(() => observer.getCurrentResult().status === "success");
  assert.deepEqual(observer.getCurrentResult().data, []);

  observer.setOptions({
    queryKey: ["monitoring", "state", "error"],
    queryFn: () => Promise.reject(new Error("section failed")),
  });
  await waitFor(() => observer.getCurrentResult().status === "error");
  assert.equal(observer.getCurrentResult().data, undefined);
  assert.match(String(observer.getCurrentResult().error), /section failed/);
  unsubscribe();
  client.clear();
});

test("cached detail content stays visible during a key change and background fetch", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const scope = monitoringScopeKey("user-a", ["team-a"]);
  let resolveSecond: ((value: string) => void) | undefined;
  const queryFn = ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const employeeId = String(queryKey[3]);
    if (employeeId === "employee-a") return Promise.resolve("cached employee");
    return new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
  };
  const observer = new QueryObserver(client, {
    queryKey: monitoringDetailQueryKey("attendance", scope, "employee-a", "2026-07-30"),
    queryFn,
    placeholderData: keepPreviousData,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await waitFor(() => observer.getCurrentResult().data === "cached employee");
  observer.setOptions({
    queryKey: monitoringDetailQueryKey("attendance", scope, "employee-b", "2026-07-30"),
    queryFn,
    placeholderData: keepPreviousData,
  });
  assert.equal(observer.getCurrentResult().data, "cached employee");
  assert.equal(observer.getCurrentResult().isPlaceholderData, true);
  assert.equal(observer.getCurrentResult().fetchStatus, "fetching");
  resolveSecond?.("fresh employee");
  await waitFor(() => observer.getCurrentResult().data === "fresh employee");
  unsubscribe();
  client.clear();
});
