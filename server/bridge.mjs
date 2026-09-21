// OrbitoDB engine bridge — the "desktop" backend the browser talks to.
//
// A browser tab can't open TCP sockets to PostgreSQL/MySQL, so this small local
// HTTP server does it on the browser's behalf using real Node drivers (pg,
// mysql2). Run it with `npm run bridge` (or `npm run dev:all`) and the web app
// will route Postgres/MySQL connections here automatically. SQLite stays fully
// in-browser and does not need this server.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import mysql from "mysql2/promise";
import initSqlJs from "sql.js";

const PORT = Number(process.env.BRIDGE_PORT) || 5174;

// Where server-side SQLite database files live. Defaults to ./data next to the
// repo (or /data in the container). Each database name maps to one file, so the
// same database name is shared across browsers, tabs, and ports.
const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const require = createRequire(import.meta.url);
const SQLJS_DIST = path.dirname(require.resolve("sql.js"));
let _sqlJs = null;
function sqlJs() {
  if (!_sqlJs) _sqlJs = initSqlJs({ locateFile: (f) => path.join(SQLJS_DIST, f) });
  return _sqlJs;
}

/** Sanitize a database name into a safe file name. */
function sqliteFileKey(name) {
  const safe = String(name || "database").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "database";
  return safe;
}
function sqlitePath(fileKey) {
  return path.join(DATA_DIR, `${fileKey}.sqlite`);
}

function sqliteBackupDir(fileKey) {
  const dir = path.join(DATA_DIR, "backups", fileKey);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function sqliteBackupId(prefix = "") {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  return `${prefix}${stamp}.sqlite`;
}
function sqliteBackupInfo(file) {
  const stat = statSync(file);
  return {
    id: path.basename(file),
    createdAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    path: file,
  };
}
function checkedBackupPath(fileKey, backupId) {
  const id = String(backupId || "");
  if (!/^[A-Za-z0-9._-]+\.sqlite$/.test(id)) throw new Error("Invalid backup id");
  return path.join(sqliteBackupDir(fileKey), id);
}
// One in-memory sql.js database per file, shared by every connection pointing at
// it (so concurrent browsers see each other's writes via this single process).
const sqliteDbs = new Map(); // fileKey -> Database
const sqliteTxn = new Set(); // fileKeys with an open transaction (defer persist)

async function openSqlite(fileKey) {
  let db = sqliteDbs.get(fileKey);
  if (db) return db;
  const SQL = await sqlJs();
  const file = sqlitePath(fileKey);
  db = existsSync(file) ? new SQL.Database(readFileSync(file)) : new SQL.Database();
  sqliteDbs.set(fileKey, db);
  if (!existsSync(file)) writeFileSync(file, Buffer.from(db.export()));
  return db;
}
function persistSqlite(fileKey) {
  const db = sqliteDbs.get(fileKey);
  if (db) writeFileSync(sqlitePath(fileKey), Buffer.from(db.export()));
}
function sqliteIdent(id) {
  return `"${String(id).replace(/"/g, '""')}"`;
}

function sqliteChecks(createSql) {
  const upper = String(createSql || "").toUpperCase();
  const source = String(createSql || "");
  const out = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const at = upper.indexOf("CHECK", searchFrom);
    if (at < 0) break;
    const open = source.indexOf("(", at + 5);
    if (open < 0) break;
    let depth = 0;
    let quote = null;
    let close = -1;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) {
          if (source[i + 1] === quote) {
            i++;
            continue;
          }
          quote = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) break;
    out.push(source.slice(open + 1, close).trim());
    searchFrom = close + 1;
  }
  return out;
}
/** Run one statement with bound params; persist (unless inside a transaction). */
function sqliteRun(fileKey, sql, params = []) {
  const db = sqliteDbs.get(fileKey);
  const st = db.prepare(sql);
  try {
    st.run(params);
  } finally {
    st.free();
  }
  if (!sqliteTxn.has(fileKey)) persistSqlite(fileKey);
}
/** Run a (possibly multi-statement) query; returns the last result set. */
function sqliteQuery(fileKey, sql, started) {
  const db = sqliteDbs.get(fileKey);
  let columns = [];
  let rows = [];
  const res = db.exec(sql);
  if (res.length) {
    const last = res[res.length - 1];
    columns = last.columns;
    rows = last.values;
  } else if (/^\s*(select|with|pragma)\b/i.test(sql)) {
    try {
      const st = db.prepare(sql);
      columns = st.getColumnNames();
      st.free();
    } catch {
      /* ignore */
    }
  }
  const s = sql.trim().toLowerCase();
  if (/^begin\b/.test(s)) sqliteTxn.add(fileKey);
  else if (/^(commit|end|rollback)\b/.test(s)) sqliteTxn.delete(fileKey);
  const isWrite = !/^\s*(select|with|pragma|explain)\b/i.test(sql);
  if (isWrite && !sqliteTxn.has(fileKey)) persistSqlite(fileKey);
  return {
    columns: columns.map((name) => ({ name, dataType: "" })),
    rows,
    rowsAffected: db.getRowsModified(),
    elapsedMs: Math.max(1, Math.round(performance.now() - started)),
    truncated: false,
  };
}

// When the bridge runs in a container, "localhost" means the container itself.
// Transparently remap localhost / 127.0.0.1 / ::1 (and empty) to the host
// machine so a database running on the user's PC is reachable. External hosts,
// LAN IPs, and compose service names pass through unchanged.
const IN_DOCKER = existsSync("/.dockerenv") || process.env.BRIDGE_IN_DOCKER === "true";
function resolveHost(host) {
  const h = String(host ?? "").trim();
  if (!IN_DOCKER) return h || "localhost";
  if (h === "" || h.toLowerCase() === "localhost" || h === "127.0.0.1" || h === "::1") return "host.docker.internal";
  return h;
}

/** Open connections keyed by the web app's connection id. */
const pools = new Map(); // id -> { engine, conn }

function appError(kind, message) {
  return { error: { kind, message } };
}
function errMessage(e) {
  // pg's happy-eyeballs wraps connection failures in an AggregateError whose
  // inner errors hold the useful ECONNREFUSED/timeout detail.
  if (e && e.name === "AggregateError" && Array.isArray(e.errors) && e.errors.length) {
    const inner = e.errors.map((x) => (x && x.message ? x.message : String(x)));
    return [...new Set(inner)].join("; ");
  }
  return e && e.message ? String(e.message) : String(e);
}

/* ---- identifier quoting + placeholders per engine ---- */
const quote = {
  postgres: (id) => `"${String(id).replace(/"/g, '""')}"`,
  mysql: (id) => `\`${String(id).replace(/`/g, "``")}\``,
};
const placeholder = { postgres: (i) => `$${i + 1}`, mysql: () => "?" };

/* ---- low-level query helpers (rows as arrays, no key collisions) ---- */
async function rawArrayRows(engine, conn, sql, params = []) {
  if (engine === "postgres") {
    // With params we use the extended (prepared) protocol; without, the simple
    // protocol — which is what allows multiple statements in one execute.
    const r = await conn.query(
      params.length ? { text: sql, values: params, rowMode: "array" } : { text: sql, rowMode: "array" },
    );
    const last = Array.isArray(r) ? r[r.length - 1] : r;
    return { columns: (last.fields || []).map((f) => f.name), rows: last.rows || [], rowsAffected: last.rowCount ?? 0 };
  }
  const [res, fields] = await conn.query(
    params.length ? { sql, values: params, rowsAsArray: true } : { sql, rowsAsArray: true },
  );
  const multi = Array.isArray(fields) && fields.length > 0 && Array.isArray(fields[0]);
  const rowsOut = multi ? res[res.length - 1] : res;
  const fld = multi ? fields[fields.length - 1] : fields;
  if (Array.isArray(rowsOut)) {
    return { columns: (fld || []).map((f) => f.name), rows: rowsOut, rowsAffected: 0 };
  }
  return { columns: [], rows: [], rowsAffected: rowsOut?.affectedRows ?? 0 };
}

function toResult(raw, startedAt) {
  return {
    columns: raw.columns.map((name) => ({ name, dataType: "" })),
    rows: raw.rows,
    rowsAffected: raw.rowsAffected,
    elapsedMs: Math.max(1, Math.round(performance.now() - startedAt)),
    truncated: false,
  };
}

/* ---- connecting ---- */
// Fail fast instead of sitting on the OS defaults: mysql2 waits 10s, but pg has
// no timeout of its own and inherits the kernel's SYN retry budget (~21s on
// Linux, longer elsewhere).
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS) || 10_000;

// Every driver code we can actually explain. A dropped SYN in particular
// surfaces as a bare "connect ETIMEDOUT" with no address attached, which — once
// resolveHost() has quietly rewritten the host — tells the user nothing at all.
const CONNECT_HINTS = {
  ETIMEDOUT: "nothing answered. A firewall is dropping the connection, or the port is wrong — check which port the server actually publishes.",
  ETIMEOUT: "nothing answered. A firewall is dropping the connection, or the port is wrong — check which port the server actually publishes.",
  ECONNREFUSED: "the machine answered but nothing is listening on that port. Check the port, and that the server is running.",
  ENOTFOUND: "that hostname doesn't resolve. Compose service names (e.g. \"mysql\") only resolve from inside the same Docker network.",
  EAI_AGAIN: "that hostname couldn't be resolved (DNS failure).",
  EHOSTUNREACH: "no route to that host.",
  ENETUNREACH: "no route to that network.",
  ECONNRESET: "the server closed the connection during the handshake. It may require TLS, or be rejecting this client.",
};

// Codes that mean we never got a usable socket. Anything else (bad password,
// unsupported auth plugin, TLS refusal) means we DID reach the server, so
// "can't reach" would be actively misleading.
const UNREACHABLE_CODES = new Set(["ETIMEDOUT", "ETIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

function connectError(e, cfg, host, port) {
  // pg's happy-eyeballs hides the real code inside an AggregateError, and its
  // own connectionTimeoutMillis rejects with a bare "timeout expired" (no code).
  const codes = [e?.code, ...(Array.isArray(e?.errors) ? e.errors.map((x) => x?.code) : [])].filter(Boolean);
  let code = codes.find((c) => CONNECT_HINTS[c]) || codes[0] || "";
  if (!code && /timeout expired|connection timeout/i.test(String(e?.message || ""))) code = "ETIMEDOUT";

  // The user typed one host; resolveHost may have dialed another. Say so —
  // otherwise the error names an address that appears nowhere in their settings.
  const typed = String(cfg.host ?? "").trim();
  const via =
    IN_DOCKER && host !== typed
      ? ` (you entered ${typed ? `"${typed}"` : "no host"} — inside Docker that means the container itself, so the bridge dialed ${host} instead)`
      : "";

  const why = CONNECT_HINTS[code] || errMessage(e);
  const lead = UNREACHABLE_CODES.has(code)
    ? `Can't reach ${cfg.engine} at ${host}:${port}${via}`
    : `Reached ${cfg.engine} at ${host}:${port}${via}, but the connection was rejected`;
  const err = new Error(`${lead} — ${why}${code ? ` [${code}]` : ""}`);
  err.kind = "connectionError";
  err.code = code;
  // Not a dropped-mid-session connection: reopening won't help, so don't let the
  // client burn a reopen+retry cycle on an endpoint that was never reachable.
  err.connectFailed = true;
  return err;
}

async function connect(cfg, password) {
  const host = resolveHost(cfg.host);
  const port = cfg.port || (cfg.engine === "postgres" ? 5432 : 3306);
  try {
    if (cfg.engine === "postgres") {
      const client = new pg.Client({
        host,
        port,
        user: cfg.username || "postgres",
        password: password ?? undefined,
        database: cfg.database || "postgres",
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      });
      await client.connect();
      const schema = String(cfg.schema || "public").trim() || "public";
      await client.query("SELECT set_config('search_path', quote_ident($1), false)", [schema]);
      return client;
    }
    if (cfg.engine === "mysql") {
      return await mysql.createConnection({
        host,
        port,
        user: cfg.username || "root",
        password: password ?? undefined,
        database: cfg.database || undefined,
        multipleStatements: true,
        connectTimeout: CONNECT_TIMEOUT_MS,
      });
    }
  } catch (e) {
    // Log it too — until now a failed connection left no trace in `docker logs`.
    console.error(`[bridge] connect failed: ${cfg.engine} ${host}:${port} — ${e?.code || ""} ${errMessage(e)}`);
    throw connectError(e, cfg, host, port);
  }
  throw new Error(`Unsupported engine for the bridge: ${cfg.engine}`);
}
async function closeConn(entry) {
  try {
    if (entry.engine === "postgres") await entry.conn.end();
    else await entry.conn.end();
  } catch {
    /* ignore */
  }
}
function need(id) {
  const e = pools.get(id);
  if (!e) {
    const err = new Error("connection_not_open");
    err.kind = "notConnected";
    throw err;
  }
  return e;
}

/* ---- request handlers ---- */
const handlers = {
  async health() {
    return { ok: true, engines: ["postgres", "mysql"] };
  },

  async test({ cfg, password }) {
    if (cfg.engine === "sqlite") {
      await sqlJs();
      return { ok: true };
    }
    const conn = await connect(cfg, password);
    await closeConn({ engine: cfg.engine, conn });
    return { ok: true };
  },

  async databases({ cfg, password }) {
    if (cfg.engine === "sqlite") {
      return readdirSync(DATA_DIR)
        .filter((f) => f.endsWith(".sqlite"))
        .map((f) => f.replace(/\.sqlite$/, ""))
        .sort();
    }
    // connect to the server's default db so we can list everything
    const base = { ...cfg, database: cfg.engine === "postgres" ? "postgres" : "" };
    const conn = await connect(base, password);
    try {
      const sql =
        cfg.engine === "postgres"
          ? "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
          : "SHOW DATABASES";
      const raw = await rawArrayRows(cfg.engine, conn, sql);
      return raw.rows.map((r) => String(r[0]));
    } finally {
      await closeConn({ engine: cfg.engine, conn });
    }
  },

  async createDatabase({ cfg, password, name }) {
    if (cfg.engine === "sqlite") {
      const key = sqliteFileKey(name);
      await openSqlite(key);
      persistSqlite(key);
      return { ok: true };
    }
    const safe = String(name).replace(/[^A-Za-z0-9_]/g, "");
    if (!safe) throw new Error("Invalid database name");
    const base = { ...cfg, database: cfg.engine === "postgres" ? "postgres" : "" };
    const conn = await connect(base, password);
    try {
      await conn.query(`CREATE DATABASE ${quote[cfg.engine](safe)}`);
      return { ok: true };
    } finally {
      await closeConn({ engine: cfg.engine, conn });
    }
  },

  async open({ id, cfg, password }) {
    if (cfg.engine === "sqlite") {
      const fileKey = sqliteFileKey(cfg.database);
      await openSqlite(fileKey);
      pools.set(id, { engine: "sqlite", conn: null, fileKey });
      return { ok: true };
    }
    const existing = pools.get(id);
    if (existing) await closeConn(existing);
    const conn = await connect(cfg, password);
    const session =
      cfg.engine === "postgres"
        ? await rawArrayRows("postgres", conn, "SELECT pg_backend_pid()")
        : await rawArrayRows("mysql", conn, "SELECT CONNECTION_ID()");
    const sessionId = Number(session.rows?.[0]?.[0] ?? 0);
    pools.set(id, { engine: cfg.engine, conn, cfg: { ...cfg }, sessionId });
    return { ok: true };
  },

  async cancel({ id, password }) {
    const e = need(id);
    if (e.engine === "sqlite") return false;
    if (!e.sessionId || !e.cfg) return false;

    const control = await connect(e.cfg, password ?? null);
    try {
      if (e.engine === "postgres") {
        const raw = await rawArrayRows(
          "postgres",
          control,
          "SELECT pg_cancel_backend($1)",
          [e.sessionId],
        );
        return Boolean(raw.rows?.[0]?.[0]);
      }
      await control.query(`KILL QUERY ${Number(e.sessionId)}`);
      return true;
    } finally {
      await closeConn({ engine: e.engine, conn: control });
    }
  },

  async diagnostics({ id }) {
    const e = need(id);
    const started = performance.now();

    if (e.engine === "sqlite") {
      const db = sqliteDbs.get(e.fileKey);
      const version = db.exec("SELECT sqlite_version()");
      const value = version.length ? String(version[0].values?.[0]?.[0] ?? "") : "";
      return {
        serverVersion: value ? `SQLite ${value}` : "SQLite",
        database: sqlitePath(e.fileKey),
        schema: "main",
        latencyMs: Math.max(1, Math.round(performance.now() - started)),
      };
    }

    const raw =
      e.engine === "postgres"
        ? await rawArrayRows(
            "postgres",
            e.conn,
            "SELECT version(), current_database(), current_schema()",
          )
        : await rawArrayRows("mysql", e.conn, "SELECT VERSION(), DATABASE()");
    return {
      serverVersion: String(raw.rows?.[0]?.[0] ?? e.engine),
      database: String(raw.rows?.[0]?.[1] ?? ""),
      schema:
        e.engine === "postgres"
          ? String(raw.rows?.[0]?.[2] ?? "")
          : String(raw.rows?.[0]?.[1] ?? ""),
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
    };
  },

  async close({ id }) {
    const e = pools.get(id);
    if (e) {
      // Keep the shared sqlite db cached for other connections; just drop pg/mysql.
      if (e.engine !== "sqlite") await closeConn(e);
      pools.delete(id);
    }
    return { ok: true };
  },

  async query({ id, sql }) {
    const e = need(id);
    const started = performance.now();
    if (e.engine === "sqlite") return sqliteQuery(e.fileKey, sql, started);
    const raw = await rawArrayRows(e.engine, e.conn, sql);
    return toResult(raw, started);
  },

  async backups({ id }) {
    const e = need(id);
    if (e.engine !== "sqlite") throw new Error("Managed snapshots are available for SQLite connections only");
    const dir = sqliteBackupDir(e.fileKey);
    return readdirSync(dir)
      .filter((name) => /^[A-Za-z0-9._-]+\.sqlite$/.test(name))
      .map((name) => sqliteBackupInfo(path.join(dir, name)))
      .sort((a, b) => b.id.localeCompare(a.id));
  },

  async createBackup({ id }) {
    const e = need(id);
    if (e.engine !== "sqlite") throw new Error("Managed snapshots are available for SQLite connections only");
    if (sqliteTxn.has(e.fileKey)) {
      throw new Error("Commit or roll back the active SQLite transaction before creating a backup");
    }
    const db = sqliteDbs.get(e.fileKey);
    const file = path.join(sqliteBackupDir(e.fileKey), sqliteBackupId());
    writeFileSync(file, Buffer.from(db.export()));
    return sqliteBackupInfo(file);
  },

  async restoreBackup({ id, backupId }) {
    const e = need(id);
    if (e.engine !== "sqlite") throw new Error("Managed restore is available for SQLite connections only");
    if (sqliteTxn.has(e.fileKey)) {
      throw new Error("Commit or roll back the active SQLite transaction before restoring a backup");
    }

    const source = checkedBackupPath(e.fileKey, backupId);
    if (!existsSync(source)) throw new Error(`Backup not found: ${backupId}`);

    const current = sqliteDbs.get(e.fileKey);
    const safety = path.join(sqliteBackupDir(e.fileKey), sqliteBackupId("before-restore-"));
    writeFileSync(safety, Buffer.from(current.export()));

    const SQL = await sqlJs();
    const replacement = new SQL.Database(readFileSync(source));
    const integrity = replacement.exec("PRAGMA integrity_check");
    const status = integrity[0]?.values?.[0]?.[0];
    if (String(status ?? "").toLowerCase() !== "ok") {
      replacement.close();
      throw new Error(`Backup integrity check failed: ${String(status ?? "unknown")}`);
    }

    try {
      current.close();
    } catch {
      /* ignore */
    }
    sqliteDbs.set(e.fileKey, replacement);
    persistSqlite(e.fileKey);
    return { ok: true };
  },

  async schemas({ id }) {
    const { engine, conn } = need(id);
    if (engine === "sqlite") return ["main", "temp"];
    if (engine === "postgres") {
      const raw = await rawArrayRows(
        engine,
        conn,
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name <> 'information_schema' AND schema_name NOT LIKE 'pg_%' ORDER BY schema_name",
      );
      return raw.rows.map((row) => String(row[0]));
    }
    const raw = await rawArrayRows(engine, conn, "SELECT database()");
    return raw.rows.length && raw.rows[0][0] ? [String(raw.rows[0][0])] : [];
  },

  async tables({ id }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      const r = sqliteDbs
        .get(fileKey)
        .exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
      const rows = r.length ? r[0].values : [];
      return rows.map((row) => ({ name: String(row[0]), kind: String(row[1]), schema: null }));
    }
    const sql =
      engine === "postgres"
        ? "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name"
        : "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = database() ORDER BY table_name";
    const raw = await rawArrayRows(engine, conn, sql);
    return raw.rows.map((r) => ({ name: String(r[0]), kind: /VIEW/i.test(String(r[1])) ? "view" : "table", schema: null }));
  },

  async objects({ id }) {
    const { engine, conn, fileKey } = need(id);

    if (engine === "sqlite") {
      const db = sqliteDbs.get(fileKey);
      const result = db.exec(
        "SELECT name, type, tbl_name, sql FROM sqlite_master WHERE type IN ('view','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
      );
      const rows = result.length ? result[0].values : [];
      return rows.map((row) => ({
        name: String(row[0] ?? ""),
        kind: String(row[1] ?? ""),
        schema: "main",
        table: row[2] == null ? null : String(row[2]),
        signature: null,
        definition:
          row[3] == null || String(row[3]).trim() === ""
            ? null
            : String(row[3]).replace(/;?\s*$/, ";"),
      }));
    }

    const out = [];
    if (engine === "postgres") {
      const views = await rawArrayRows(
        engine,
        conn,
        `SELECT schemaname, viewname,
                'CREATE OR REPLACE VIEW ' || quote_ident(viewname) || ' AS ' ||
                pg_get_viewdef((quote_ident(schemaname) || '.' || quote_ident(viewname))::regclass, true) || ';'
         FROM pg_views WHERE schemaname = current_schema() ORDER BY viewname`,
      );
      for (const row of views.rows) {
        out.push({
          name: String(row[1] ?? ""),
          kind: "view",
          schema: row[0] == null ? null : String(row[0]),
          table: null,
          signature: null,
          definition: row[2] == null ? null : String(row[2]),
        });
      }

      const indexes = await rawArrayRows(
        engine,
        conn,
        `SELECT pgi.schemaname, pgi.tablename, pgi.indexname, pgi.indexdef
         FROM pg_indexes pgi
         WHERE pgi.schemaname = current_schema()
           AND NOT EXISTS (
             SELECT 1 FROM pg_constraint con
             JOIN pg_class idx ON idx.oid = con.conindid
             JOIN pg_namespace ns ON ns.oid = idx.relnamespace
             WHERE con.conindid <> 0
               AND ns.nspname = pgi.schemaname
               AND idx.relname = pgi.indexname
           )
         ORDER BY pgi.tablename, pgi.indexname`,
      );
      for (const row of indexes.rows) {
        out.push({
          name: String(row[2] ?? ""),
          kind: "index",
          schema: row[0] == null ? null : String(row[0]),
          table: row[1] == null ? null : String(row[1]),
          signature: null,
          definition: row[3] == null ? null : String(row[3]).replace(/;?\s*$/, ";"),
        });
      }

      const sequences = await rawArrayRows(
        engine,
        conn,
        `SELECT schemaname, sequencename,
                format('CREATE SEQUENCE %I INCREMENT BY %s MINVALUE %s MAXVALUE %s START WITH %s CACHE %s %s;',
                       sequencename, increment_by, min_value, max_value, start_value, cache_size,
                       CASE WHEN cycle THEN 'CYCLE' ELSE 'NO CYCLE' END)
         FROM pg_sequences WHERE schemaname = current_schema() ORDER BY sequencename`,
      );
      for (const row of sequences.rows) {
        out.push({
          name: String(row[1] ?? ""),
          kind: "sequence",
          schema: row[0] == null ? null : String(row[0]),
          table: null,
          signature: null,
          definition: row[2] == null ? null : String(row[2]),
        });
      }

      const routines = await rawArrayRows(
        engine,
        conn,
        `SELECT p.proname, p.prokind::text, n.nspname,
                pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = current_schema() AND p.prokind IN ('f','p')
         ORDER BY p.prokind, p.proname, pg_get_function_identity_arguments(p.oid)`,
      );
      for (const row of routines.rows) {
        out.push({
          name: String(row[0] ?? ""),
          kind: String(row[1]) === "p" ? "procedure" : "function",
          schema: row[2] == null ? null : String(row[2]),
          table: null,
          signature: row[3] == null ? null : String(row[3]),
          definition: row[4] == null ? null : String(row[4]).replace(/;?\s*$/, ";"),
        });
      }

      const triggers = await rawArrayRows(
        engine,
        conn,
        `SELECT tg.tgname, cls.relname, ns.nspname, pg_get_triggerdef(tg.oid, true) || ';'
         FROM pg_trigger tg
         JOIN pg_class cls ON cls.oid = tg.tgrelid
         JOIN pg_namespace ns ON ns.oid = cls.relnamespace
         WHERE NOT tg.tgisinternal AND ns.nspname = current_schema()
         ORDER BY cls.relname, tg.tgname`,
      );
      for (const row of triggers.rows) {
        out.push({
          name: String(row[0] ?? ""),
          kind: "trigger",
          schema: row[2] == null ? null : String(row[2]),
          table: row[1] == null ? null : String(row[1]),
          signature: null,
          definition: row[3] == null ? null : String(row[3]),
        });
      }
      return out;
    }

    const views = await rawArrayRows(
      engine,
      conn,
      "SELECT table_name FROM information_schema.views WHERE table_schema = DATABASE() ORDER BY table_name",
    );
    for (const row of views.rows) {
      const name = String(row[0] ?? "");
      if (!name) continue;
      let definition = null;
      try {
        const shown = await rawArrayRows(engine, conn, `SHOW CREATE VIEW ${quote.mysql(name)}`);
        const idx = shown.columns.findIndex((column) => String(column).toLowerCase() === "create view");
        if (idx >= 0 && shown.rows[0]?.[idx] != null) {
          definition = String(shown.rows[0][idx]).replace(/;?\s*$/, ";");
        }
      } catch {
        // Keep the object visible even when SHOW CREATE requires more privileges.
      }
      out.push({ name, kind: "view", schema: null, table: null, signature: null, definition });
    }

    const baseTables = await rawArrayRows(
      engine,
      conn,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    for (const tableRow of baseTables.rows) {
      const table = String(tableRow[0] ?? "");
      if (!table) continue;
      const raw = await rawArrayRows(engine, conn, `SHOW INDEX FROM ${quote.mysql(table)}`);
      const grouped = new Map();
      for (const row of raw.rows) {
        const name = String(row[2] ?? "");
        if (!name) continue;
        const item = grouped.get(name) ?? { unique: Number(row[1] ?? 1) === 0, columns: [] };
        const column = String(row[4] ?? "");
        if (column) item.columns.push(column);
        grouped.set(name, item);
      }
      for (const [name, item] of grouped.entries()) {
        if (name === "PRIMARY") continue;
        const definition =
          !item.columns.length
            ? null
            : `CREATE ${item.unique ? "UNIQUE " : ""}INDEX ${quote.mysql(name)} ON ${quote.mysql(table)} (${item.columns
                .map((column) => quote.mysql(column))
                .join(", ")});`;
        out.push({ name, kind: "index", schema: null, table, signature: null, definition });
      }
    }

    const routines = await rawArrayRows(
      engine,
      conn,
      "SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = DATABASE() ORDER BY routine_type, routine_name",
    );
    for (const row of routines.rows) {
      const name = String(row[0] ?? "");
      const routineType = String(row[1] ?? "").toUpperCase();
      if (!name) continue;
      const kind = routineType === "PROCEDURE" ? "procedure" : "function";
      let definition = null;
      try {
        const shown = await rawArrayRows(
          engine,
          conn,
          `SHOW CREATE ${routineType === "PROCEDURE" ? "PROCEDURE" : "FUNCTION"} ${quote.mysql(name)}`,
        );
        const wanted = routineType === "PROCEDURE" ? "create procedure" : "create function";
        const idx = shown.columns.findIndex((column) => String(column).toLowerCase() === wanted);
        if (idx >= 0 && shown.rows[0]?.[idx] != null) {
          definition = String(shown.rows[0][idx]).replace(/;?\s*$/, ";");
        }
      } catch {
        // Keep metadata listing available with limited privileges.
      }
      out.push({ name, kind, schema: null, table: null, signature: null, definition });
    }

    const triggers = await rawArrayRows(
      engine,
      conn,
      `SELECT trigger_name, event_object_table, action_timing, event_manipulation, action_statement
       FROM information_schema.triggers
       WHERE trigger_schema = DATABASE()
       ORDER BY event_object_table, trigger_name`,
    );
    for (const row of triggers.rows) {
      const name = String(row[0] ?? "");
      const table = String(row[1] ?? "");
      const timing = String(row[2] ?? "");
      const event = String(row[3] ?? "");
      const statement = String(row[4] ?? "");
      out.push({
        name,
        kind: "trigger",
        schema: null,
        table: table || null,
        signature: null,
        definition:
          name && table && timing && event && statement
            ? `CREATE TRIGGER ${quote.mysql(name)} ${timing} ${event} ON ${quote.mysql(table)} FOR EACH ROW ${statement.replace(/;?\s*$/, "")};`
            : null,
      });
    }

    return out;
  },

  async columns({ id, table }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      const r = sqliteDbs.get(fileKey).exec(`PRAGMA table_xinfo(${sqliteIdent(table)})`);
      const rows = r.length ? r[0].values : [];
      return rows.map((row) => {
        const hidden = Number(row[6] ?? 0);
        return {
          name: String(row[1]),
          dataType: row[2] ? String(row[2]) : "",
          nullable: Number(row[3]) === 0,
          isPrimaryKey: Number(row[5]) > 0,
          defaultValue: row[4] == null ? null : String(row[4]),
          generated:
            hidden === 2
              ? "VIRTUAL (expression unavailable)"
              : hidden === 3
                ? "STORED (expression unavailable)"
                : null,
          comment: null,
          extra:
            hidden === 2
              ? "VIRTUAL GENERATED"
              : hidden === 3
                ? "STORED GENERATED"
                : null,
        };
      });
    }
    if (engine === "postgres") {
      const sql = `
        SELECT a.attname AS column_name,
               pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
               NOT a.attnotnull AS is_nullable,
               CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
               CASE WHEN a.attgenerated = '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) END AS column_default,
               CASE WHEN a.attgenerated <> '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) END AS generation_expression,
               pg_catalog.col_description(a.attrelid, a.attnum) AS column_comment,
               CASE a.attidentity WHEN 'a' THEN 'IDENTITY ALWAYS' WHEN 'd' THEN 'IDENTITY BY DEFAULT' ELSE NULL END AS column_extra
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class cls ON cls.oid = a.attrelid
        JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        LEFT JOIN (
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = current_schema()
        ) pk ON pk.column_name = a.attname
        WHERE ns.nspname = current_schema() AND cls.relname = $1
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`;
      const raw = await rawArrayRows(engine, conn, sql, [table]);
      return raw.rows.map((r) => ({
        name: String(r[0]),
        dataType: String(r[1] || ""),
        nullable: Boolean(r[2]),
        isPrimaryKey: Number(r[3]) === 1,
        defaultValue: r[4] == null ? null : String(r[4]),
        generated: r[5] == null ? null : String(r[5]),
        comment: r[6] == null ? null : String(r[6]),
        extra: r[7] == null ? null : String(r[7]),
      }));
    }
    const sql =
      "SELECT column_name, column_type, is_nullable, column_key, column_default, generation_expression, column_comment, extra FROM information_schema.columns WHERE table_name = ? AND table_schema = database() ORDER BY ordinal_position";
    const raw = await rawArrayRows(engine, conn, sql, [table]);
    return raw.rows.map((r) => ({
      name: String(r[0]),
      dataType: String(r[1] || ""),
      nullable: String(r[2]).toUpperCase() === "YES",
      isPrimaryKey: String(r[3]).toUpperCase() === "PRI",
      defaultValue: r[4] == null ? null : String(r[4]),
      generated: r[5] == null || String(r[5]).trim() === "" ? null : String(r[5]),
      comment: r[6] == null || String(r[6]) === "" ? null : String(r[6]),
      extra: r[7] == null || String(r[7]) === "" ? null : String(r[7]),
    }));
  },

  async foreignKeys({ id }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      const db = sqliteDbs.get(fileKey);
      const tr = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      const names = (tr.length ? tr[0].values : []).map((r) => String(r[0]));
      const out = [];
      for (const t of names) {
        const r = db.exec(`PRAGMA foreign_key_list(${sqliteIdent(t)})`);
        for (const row of r.length ? r[0].values : []) {
          out.push({ name: null, table: t, column: String(row[3]), refTable: String(row[2]), refColumn: row[4] == null ? "" : String(row[4]) });
        }
      }
      return out;
    }
    const sql =
      engine === "postgres"
        ? `SELECT tc.constraint_name, tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
           WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()`
        : `SELECT constraint_name, table_name, column_name, referenced_table_name, referenced_column_name
           FROM information_schema.key_column_usage
           WHERE referenced_table_name IS NOT NULL AND table_schema = database()`;
    const raw = await rawArrayRows(engine, conn, sql);
    return raw.rows.map((r) => ({
      name: r[0] == null ? null : String(r[0]),
      table: String(r[1]),
      column: String(r[2]),
      refTable: String(r[3]),
      refColumn: String(r[4]),
    }));
  },

  async indexes({ id, table }) {
    const { engine, conn, fileKey } = need(id);

    if (engine === "sqlite") {
      const db = sqliteDbs.get(fileKey);
      const r = db.exec(`PRAGMA index_list(${sqliteIdent(table)})`);
      const rows = r.length ? r[0].values : [];
      return rows.map((row) => {
        const name = String(row[1] ?? "");
        const info = name ? db.exec(`PRAGMA index_info(${sqliteIdent(name)})`) : [];
        const columns = (info.length ? info[0].values : [])
          .map((item) => String(item[2] ?? ""))
          .filter(Boolean);
        const origin = row[3] == null ? "" : String(row[3]);
        const detail = columns.length
          ? origin && origin !== "c"
            ? `${columns.join(", ")} · origin: ${origin}`
            : columns.join(", ")
          : origin
            ? `origin: ${origin}`
            : "SQLite index";
        return {
          name,
          unique: Number(row[2] ?? 0) === 1,
          detail,
        };
      });
    }

    if (engine === "postgres") {
      const raw = await rawArrayRows(
        engine,
        conn,
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = $1
         ORDER BY indexname`,
        [table],
      );
      return raw.rows.map((row) => {
        const definition = String(row[1] ?? "");
        return {
          name: String(row[0] ?? ""),
          unique: /CREATE\s+UNIQUE\s+INDEX/i.test(definition),
          detail: definition,
        };
      });
    }

    const raw = await rawArrayRows(engine, conn, `SHOW INDEX FROM ${quote.mysql(table)}`);
    const grouped = new Map();
    for (const row of raw.rows) {
      const name = String(row[2] ?? "");
      if (!name) continue;
      const item = grouped.get(name) ?? { unique: Number(row[1] ?? 1) === 0, columns: [] };
      const column = String(row[4] ?? "");
      if (column) item.columns.push(column);
      grouped.set(name, item);
    }
    return [...grouped.entries()].map(([name, item]) => ({
      name,
      unique: item.unique,
      detail: item.columns.join(", ") || "MySQL index",
    }));
  },

  async constraints({ id, table }) {
    const { engine, conn, fileKey } = need(id);

    if (engine === "sqlite") {
      const db = sqliteDbs.get(fileKey);
      const out = [];
      const colsResult = db.exec(`PRAGMA table_xinfo(${sqliteIdent(table)})`);
      const cols = colsResult.length ? colsResult[0].values : [];
      const primary = cols
        .filter((row) => Number(row[5] ?? 0) > 0)
        .sort((a, b) => Number(a[5] ?? 0) - Number(b[5] ?? 0))
        .map((row) => String(row[1]));
      if (primary.length) {
        out.push({
          name: null,
          kind: "primary",
          definition: `PRIMARY KEY (${primary.join(", ")})`,
          columns: primary,
        });
      }

      const idxResult = db.exec(`PRAGMA index_list(${sqliteIdent(table)})`);
      for (const row of idxResult.length ? idxResult[0].values : []) {
        const name = String(row[1] ?? "");
        const origin = row[3] == null ? "" : String(row[3]);
        if (!name || origin !== "u") continue;
        const info = db.exec(`PRAGMA index_info(${sqliteIdent(name)})`);
        const columns = (info.length ? info[0].values : [])
          .map((item) => String(item[2] ?? ""))
          .filter(Boolean);
        out.push({
          name: null,
          kind: "unique",
          definition: `UNIQUE (${columns.join(", ")})`,
          columns,
        });
      }

      const st = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?");
      try {
        st.bind([table]);
        if (st.step()) {
          for (const expression of sqliteChecks(String(st.get()[0] ?? ""))) {
            out.push({
              name: null,
              kind: "check",
              definition: `CHECK (${expression})`,
              columns: [],
            });
          }
        }
      } finally {
        st.free();
      }
      return out;
    }

    if (engine === "postgres") {
      const raw = await rawArrayRows(
        engine,
        conn,
        `SELECT con.conname, con.contype, pg_catalog.pg_get_constraintdef(con.oid, true),
                COALESCE(string_agg(att.attname, ',' ORDER BY ord.ordinality), '')
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
         JOIN pg_catalog.pg_namespace ns ON ns.oid = rel.relnamespace
         LEFT JOIN LATERAL unnest(con.conkey) WITH ORDINALITY ord(attnum, ordinality) ON true
         LEFT JOIN pg_catalog.pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ord.attnum
         WHERE ns.nspname = current_schema() AND rel.relname = $1
           AND con.contype IN ('p','u','c')
         GROUP BY con.oid, con.conname, con.contype
         ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 ELSE 2 END, con.conname`,
        [table],
      );
      return raw.rows.map((row) => ({
        name: row[0] == null ? null : String(row[0]),
        kind: String(row[1]) === "p" ? "primary" : String(row[1]) === "u" ? "unique" : "check",
        definition: String(row[2] ?? ""),
        columns: String(row[3] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      }));
    }

    const keys = await rawArrayRows(
      engine,
      conn,
      `SELECT tc.constraint_name, tc.constraint_type,
              GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position SEPARATOR ',')
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = tc.constraint_schema
        AND kcu.table_name = tc.table_name
        AND kcu.constraint_name = tc.constraint_name
       WHERE tc.table_schema = DATABASE() AND tc.table_name = ?
         AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
       GROUP BY tc.constraint_name, tc.constraint_type
       ORDER BY CASE tc.constraint_type WHEN 'PRIMARY KEY' THEN 0 ELSE 1 END, tc.constraint_name`,
      [table],
    );
    const out = keys.rows.map((row) => {
      const columns = String(row[2] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const primary = String(row[1]) === "PRIMARY KEY";
      return {
        name: row[0] == null ? null : String(row[0]),
        kind: primary ? "primary" : "unique",
        definition: `${primary ? "PRIMARY KEY" : "UNIQUE"} (${columns.join(", ")})`,
        columns,
      };
    });

    try {
      const checks = await rawArrayRows(
        engine,
        conn,
        `SELECT tc.constraint_name, cc.check_clause
         FROM information_schema.table_constraints tc
         JOIN information_schema.check_constraints cc
           ON cc.constraint_schema = tc.constraint_schema
          AND cc.constraint_name = tc.constraint_name
         WHERE tc.table_schema = DATABASE() AND tc.table_name = ?
           AND tc.constraint_type = 'CHECK'
         ORDER BY tc.constraint_name`,
        [table],
      );
      for (const row of checks.rows) {
        const clause = String(row[1] ?? "");
        out.push({
          name: row[0] == null ? null : String(row[0]),
          kind: "check",
          definition: clause ? `CHECK (${clause})` : "CHECK",
          columns: [],
        });
      }
    } catch {
      // Older MySQL variants may not expose CHECK_CONSTRAINTS.
    }
    return out;
  },

  async updateCell({ id, table, pkColumn, pkValue, column, value }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      sqliteRun(fileKey, `UPDATE ${sqliteIdent(table)} SET ${sqliteIdent(column)} = ? WHERE ${sqliteIdent(pkColumn)} = ?`, [value, pkValue]);
      return { ok: true };
    }
    const Q = quote[engine];
    const P = placeholder[engine];
    await conn.query(`UPDATE ${Q(table)} SET ${Q(column)} = ${P(0)} WHERE ${Q(pkColumn)} = ${P(1)}`, [value, pkValue]);
    return { ok: true };
  },
  async deleteRow({ id, table, pkColumn, pkValue }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      sqliteRun(fileKey, `DELETE FROM ${sqliteIdent(table)} WHERE ${sqliteIdent(pkColumn)} = ?`, [pkValue]);
      return { ok: true };
    }
    const Q = quote[engine];
    await conn.query(`DELETE FROM ${Q(table)} WHERE ${Q(pkColumn)} = ${placeholder[engine](0)}`, [pkValue]);
    return { ok: true };
  },
  async insertRow({ id, table, columns, values }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      if (columns.length === 0) {
        sqliteRun(fileKey, `INSERT INTO ${sqliteIdent(table)} DEFAULT VALUES`);
      } else {
        const cols = columns.map(sqliteIdent).join(", ");
        const ph = columns.map(() => "?").join(", ");
        sqliteRun(fileKey, `INSERT INTO ${sqliteIdent(table)} (${cols}) VALUES (${ph})`, values);
      }
      return { ok: true };
    }
    const Q = quote[engine];
    const cols = columns.map(Q).join(", ");
    const ph = columns.map((_, i) => placeholder[engine](i)).join(", ");
    await conn.query(`INSERT INTO ${Q(table)} (${cols}) VALUES (${ph})`, values);
    return { ok: true };
  },
  async dropTable({ id, table }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      // A view needs DROP VIEW, not DROP TABLE — look up which it is.
      const db = sqliteDbs.get(fileKey);
      let type = "table";
      const st = db.prepare("SELECT type FROM sqlite_master WHERE name = ?");
      try {
        st.bind([table]);
        if (st.step()) type = String(st.get()[0] || "table");
      } finally {
        st.free();
      }
      sqliteRun(fileKey, `DROP ${/view/i.test(type) ? "VIEW" : "TABLE"} IF EXISTS ${sqliteIdent(table)}`);
      return { ok: true };
    }
    if (engine === "mysql") {
      // DROP TABLE silently no-ops a view (and vice-versa); issue both so either
      // a base table or a view is removed. IF EXISTS keeps the other a no-op.
      for (const kw of ["TABLE", "VIEW"]) {
        await conn.query(`DROP ${kw} IF EXISTS ${quote.mysql(table)}`);
      }
      return { ok: true };
    }
    // PostgreSQL: IF EXISTS doesn't suppress a wrong-type error, so pick the type.
    const tr = await conn.query({
      text: "SELECT table_type FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
      values: [table],
      rowMode: "array",
    });
    const rows = Array.isArray(tr) ? tr[tr.length - 1].rows : tr.rows;
    const isView = !!rows?.[0] && /VIEW/i.test(String(rows[0][0] ?? ""));
    await conn.query(`DROP ${isView ? "VIEW" : "TABLE"} IF EXISTS ${quote.postgres(table)}`);
    return { ok: true };
  },
  async createTable({ id, name, columns }) {
    const { engine, conn, fileKey } = need(id);
    const cols = columns.length ? columns : [{ name: "id", dataType: "INTEGER", nullable: false, primaryKey: true }];
    if (engine === "sqlite") {
      const defs = cols
        .map((c) => {
          const parts = [sqliteIdent(c.name), c.dataType || "TEXT"];
          if (c.primaryKey) parts.push("PRIMARY KEY");
          else if (!c.nullable) parts.push("NOT NULL");
          return parts.join(" ");
        })
        .join(", ");
      sqliteRun(fileKey, `CREATE TABLE ${sqliteIdent(name)} (${defs})`);
      return { ok: true };
    }
    const Q = quote[engine];
    const defs = cols
      .map((c) => {
        const parts = [Q(c.name), c.dataType || "TEXT"];
        if (c.primaryKey) parts.push("PRIMARY KEY");
        else if (!c.nullable) parts.push("NOT NULL");
        return parts.join(" ");
      })
      .join(", ");
    await conn.query(`CREATE TABLE ${Q(name)} (${defs})`);
    return { ok: true };
  },
  async addColumn({ id, table, column }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      sqliteRun(fileKey, `ALTER TABLE ${sqliteIdent(table)} ADD COLUMN ${sqliteIdent(column.name)} ${column.dataType || "TEXT"}`);
      return { ok: true };
    }
    const Q = quote[engine];
    await conn.query(`ALTER TABLE ${Q(table)} ADD COLUMN ${Q(column.name)} ${column.dataType || "TEXT"}`);
    return { ok: true };
  },
  async dropColumn({ id, table, column }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      sqliteRun(fileKey, `ALTER TABLE ${sqliteIdent(table)} DROP COLUMN ${sqliteIdent(column)}`);
      return { ok: true };
    }
    const Q = quote[engine];
    await conn.query(`ALTER TABLE ${Q(table)} DROP COLUMN ${Q(column)}`);
    return { ok: true };
  },
  async renameColumn({ id, table, from, to }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      sqliteRun(fileKey, `ALTER TABLE ${sqliteIdent(table)} RENAME COLUMN ${sqliteIdent(from)} TO ${sqliteIdent(to)}`);
      return { ok: true };
    }
    const Q = quote[engine];
    await conn.query(`ALTER TABLE ${Q(table)} RENAME COLUMN ${Q(from)} TO ${Q(to)}`);
    return { ok: true };
  },
  async renameTable({ id, from, to }) {
    const { engine, conn, fileKey } = need(id);
    if (engine === "sqlite") {
      sqliteRun(fileKey, `ALTER TABLE ${sqliteIdent(from)} RENAME TO ${sqliteIdent(to)}`);
      return { ok: true };
    }
    const Q = quote[engine];
    const sql =
      engine === "mysql" ? `RENAME TABLE ${Q(from)} TO ${Q(to)}` : `ALTER TABLE ${Q(from)} RENAME TO ${Q(to)}`;
    await conn.query(sql);
    return { ok: true };
  },
};

/* ---- HTTP plumbing ---- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function sendJson(res, status, obj) {
  // Serialize BEFORE touching the response, so a serialization failure becomes a
  // clean error instead of a half-sent 200 (which the proxy turns into a 500).
  let body;
  let code = status;
  try {
    body = JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  } catch (e) {
    code = 400;
    body = JSON.stringify({ error: { kind: "internal", message: `Result not serializable: ${String(e)}` } });
  }
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    return;
  }
  cors(res);
  res.setHeader("Content-Type", "application/json");
  res.writeHead(code);
  res.end(body);
}

// A DB connection dropped out from under us (idle timeout, server restart, …)?
// Distinct from "can't reach the DB at all" (ECONNREFUSED), which reopening
// won't fix.
function isConnLost(e) {
  if (!e) return false;
  if (e.connectFailed) return false; // never established — reopening can't fix it
  if (e.fatal) return true;
  if (["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE"].includes(e.code)) return true;
  return /closed state|server has gone away|connection lost|connection terminated|terminating connection/i.test(String(e.message || ""));
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  const path = (req.url || "").replace(/^\/api\//, "").replace(/\?.*$/, "").replace(/^\//, "");
  const handler = handlers[path];
  if (!handler) return sendJson(res, 404, appError("notFound", `Unknown endpoint: ${path}`));

  if (req.method === "GET") {
    Promise.resolve(handler({}))
      .then((out) => sendJson(res, 200, out))
      .catch((e) => sendJson(res, 400, appError(e.kind || "internal", errMessage(e))));
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    let body = {};
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    } catch {
      return sendJson(res, 400, appError("badRequest", "Invalid JSON body"));
    }
    try {
      const out = await handler(body);
      sendJson(res, 200, out);
    } catch (e) {
      // A dropped DB connection: forget it and report notConnected so the client
      // transparently reopens + retries (self-heals idle timeouts).
      if (isConnLost(e) && body && body.id) {
        const ent = pools.get(body.id);
        if (ent) {
          try {
            await closeConn(ent);
          } catch {
            /* ignore */
          }
          pools.delete(body.id);
        }
        return sendJson(res, 400, appError("notConnected", errMessage(e)));
      }
      sendJson(res, 400, appError(e.kind || (e.code ? "connectionError" : "queryError"), errMessage(e)));
    }
  });
});

// One bad request must never take the whole bridge down.
process.on("uncaughtException", (e) => console.error("[bridge] uncaughtException:", e));
process.on("unhandledRejection", (e) => console.error("[bridge] unhandledRejection:", e));

server.listen(PORT, () => {
  console.log(`OrbitoDB engine bridge listening on http://localhost:${PORT}  (PostgreSQL + MySQL)`);
});
