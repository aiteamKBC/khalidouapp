import { TOXIPROXY_API_PORT } from "../lib/env.ts";

const base = `http://127.0.0.1:${TOXIPROXY_API_PORT}/proxies/khaliduo-e2e`;
export async function toxic(name: string, type: string, attributes: Record<string, number>, stream = "downstream") {
  const response = await fetch(`${base}/toxics`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, type, stream, toxicity: 1, attributes }),
  });
  if (!response.ok) throw new Error(`Adding toxic failed: ${response.status} ${await response.text()}`);
}
export async function clearToxics() {
  const response = await fetch(`${base}/toxics`);
  if (!response.ok) throw new Error(`Reading toxics failed: ${response.status}`);
  for (const item of await response.json() as {name: string}[]) {
    const removed = await fetch(`${base}/toxics/${encodeURIComponent(item.name)}`, { method: "DELETE" });
    if (!removed.ok) throw new Error(`Removing toxic failed: ${removed.status}`);
  }
}
