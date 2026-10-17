// Switchable reverse proxy between the desktop app and the backend.
//
// Tests drive it over HTTP (POST /__e2e/mode) to make the network "go away"
// (offline), come back (online), or answer every agent call with a fixed
// status code (e.g. 401) to exercise the outbox replay policy.
//
// Run: node lib/proxy-server.ts <listenPort> <targetPort>
import http from "node:http";

const listenPort = Number(process.argv[2]);
const targetPort = Number(process.argv[3]);

type Mode = { kind: "online" } | { kind: "offline" } | { kind: "status"; status: number; pathPrefix: string };
let mode: Mode = { kind: "online" };
const counters = { forwarded: 0, dropped: 0, faked: 0 };

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/__e2e/")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method === "POST" && url === "/__e2e/mode") {
        mode = JSON.parse(body) as Mode;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ mode, counters }));
    });
    return;
  }

  if (mode.kind === "offline") {
    counters.dropped += 1;
    req.socket.destroy();
    return;
  }
  if (mode.kind === "status" && url.startsWith(mode.pathPrefix)) {
    counters.faked += 1;
    req.resume();
    res.writeHead(mode.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "E2E_FAKED", message: `Faked ${mode.status} by the E2E proxy` } }));
    return;
  }

  counters.forwarded += 1;
  const upstream = http.request(
    { host: "127.0.0.1", port: targetPort, method: req.method, path: url, headers: req.headers },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`e2e proxy :${listenPort} -> :${targetPort}`);
});
