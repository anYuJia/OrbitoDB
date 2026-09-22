import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const port = 18000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const allowedOrigin = "https://trusted.example";
const dataDir = mkdtempSync(path.join(tmpdir(), "orbitodb-bridge-smoke-"));
const child = spawn(process.execPath, ["server/bridge.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BRIDGE_HOST: "127.0.0.1",
    BRIDGE_PORT: String(port),
    BRIDGE_ALLOWED_ORIGINS: allowedOrigin,
    DATA_DIR: dataDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => {
  logs += chunk;
});
child.stderr.on("data", (chunk) => {
  logs += chunk;
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(pathname, body) {
  const response = await fetch(`${base}/api/${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

async function waitUntilReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`bridge exited early (${child.exitCode})\n${logs}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await delay(100);
  }
  throw new Error(`bridge did not become ready\n${logs}`);
}

try {
  await waitUntilReady();

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual((await health.json()).engines, ["postgres", "mysql"]);

  const unexpectedGet = await fetch(`${base}/api/query`);
  assert.equal(unexpectedGet.status, 405);

  const unsafePost = await fetch(`${base}/api/test`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(unsafePost.status, 415);

  const rejectedOrigin = await fetch(`${base}/api/query`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(rejectedOrigin.status, 403);
  assert.equal(rejectedOrigin.headers.get("access-control-allow-origin"), null);

  const acceptedOrigin = await fetch(`${base}/api/query`, {
    method: "OPTIONS",
    headers: { Origin: allowedOrigin, "Access-Control-Request-Method": "POST" },
  });
  assert.equal(acceptedOrigin.status, 204);
  assert.equal(acceptedOrigin.headers.get("access-control-allow-origin"), allowedOrigin);

  const sqlite = {
    id: "smoke-sqlite",
    name: "Smoke SQLite",
    engine: "sqlite",
    database: "smoke.sqlite",
  };
  await post("open", { id: sqlite.id, cfg: sqlite, password: null });
  await post("query", {
    id: sqlite.id,
    sql: "CREATE TABLE defaults_test (id INTEGER PRIMARY KEY, note TEXT DEFAULT 'ready')",
  });
  await post("insertRow", { id: sqlite.id, table: "defaults_test", columns: [], values: [] });
  const defaultRow = await post("query", { id: sqlite.id, sql: "SELECT note FROM defaults_test" });
  assert.deepEqual(defaultRow.rows, [["ready"]]);
  await post("close", { id: sqlite.id });

  console.log("bridge smoke test passed");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}
