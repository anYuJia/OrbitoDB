// Real, browser-native backend: a full SQLite engine (sql.js / WebAssembly).
// Databases are real and persist to IndexedDB; saved connections persist to
// localStorage. No server required — create a database and it just works.
//
// Remote engines (PostgreSQL / MySQL) can't be reached from a browser tab, so
// those require the OrbitoDB desktop build (Tauri); here they error clearly.
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { Backend } from "./backend";
import type {
  AppError,
  BackupInfo,
  ColumnDef,
  ColumnInfo,
  ConnectionConfig,
  ConstraintInfo,
  DatabaseObjectInfo,
  ForeignKey,
  IndexInfo,
  HistoryEntry,
  QueryResult,
  TableInfo,
} from "./types";

const CONNS_KEY = "orbitodb.connections";
const HIST_KEY = "orbitodb.history";

function loadConns(): ConnectionConfig[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CONNS_KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as ConnectionConfig[]) : [];
  } catch {
    return [];
  }
}
function saveConns(list: ConnectionConfig[]): void {
  try {
    localStorage.setItem(CONNS_KEY, JSON.stringify(list));
  } catch {
    /* storage full / unavailable */
  }
}

/** Double-quote a SQL identifier (table/column name). */
function q(id: string): string {
  return `"${String(id).replace(/"/g, '""')}"`;
}

function sqliteChecks(createSql: string): string[] {
  const upper = createSql.toUpperCase();
  const out: string[] = [];
  let searchFrom = 0;
  while (searchFrom < createSql.length) {
    const rel = upper.indexOf("CHECK", searchFrom);
    if (rel < 0) break;
    const open = createSql.indexOf("(", rel + 5);
    if (open < 0) break;
    let depth = 0;
    let quote: "'" | '"' | null = null;
    let close = -1;
    for (let i = open; i < createSql.length; i++) {
      const ch = createSql[i];
      if (quote) {
        if (ch === quote) {
          if (createSql[i + 1] === quote) {
            i++;
            continue;
          }
          quote = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) break;
    out.push(createSql.slice(open + 1, close).trim());
    searchFrom = close + 1;
  }
  return out;
}

function remoteErr(): AppError {
  return {
    kind: "notSupported",
    message:
      "Remote databases (PostgreSQL / MySQL) need the OrbitoDB desktop app. In the browser you can create and use real local SQLite databases.",
  };
}
function queryErr(e: unknown): AppError {
  return { kind: "queryError", message: e instanceof Error ? e.message : String(e) };
}

/* ----------------------------------------------------- IndexedDB blob store */

const IDB_NAME = "orbitodb";
const IDB_STORE = "dbs";
let _idb: Promise<IDBDatabase> | null = null;

function idb(): Promise<IDBDatabase> {
  if (_idb) return _idb;
  _idb = new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _idb;
}
async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
    t.onsuccess = () => res(t.result as Uint8Array | undefined);
    t.onerror = () => rej(t.error);
  });
}
async function idbSet(key: string, val: Uint8Array): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(val, key);
    t.onsuccess = () => res();
    t.onerror = () => rej(t.error);
  });
}
async function idbDel(key: string): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).delete(key);
    t.onsuccess = () => res();
    t.onerror = () => rej(t.error);
  });
}

/* ----------------------------------------------------------------- backend */

class LocalBackend implements Backend {
  private sql: Promise<SqlJsStatic> | null = null;
  private open = new Map<string, Database>();
  // Connection ids with an open manual transaction — persistence is deferred
  // until COMMIT/ROLLBACK so a half-finished transaction can't survive a reload.
  private txn = new Set<string>();

  private SQL(): Promise<SqlJsStatic> {
    if (!this.sql) this.sql = initSqlJs({ locateFile: () => sqlWasmUrl });
    return this.sql;
  }

  private cfg(id: string): ConnectionConfig | undefined {
    return loadConns().find((c) => c.id === id);
  }

  private async ensureDb(id: string): Promise<Database> {
    const cached = this.open.get(id);
    if (cached) return cached;
    const c = this.cfg(id);
    if (c && c.engine !== "sqlite") throw remoteErr();
    const SQL = await this.SQL();
    const bytes = await idbGet(id);
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.open.set(id, db);
    if (!bytes) await this.persist(id); // materialize the empty database
    return db;
  }
  private async persist(id: string): Promise<void> {
    const db = this.open.get(id);
    if (db) await idbSet(id, db.export());
  }
  private async mutate(id: string, sql: string, params: unknown[] = []): Promise<void> {
    const db = await this.ensureDb(id);
    try {
      db.run(sql, params as never);
    } catch (e) {
      throw queryErr(e);
    }
    await this.persist(id);
  }

  /* ---- connections (persisted to localStorage) ---- */
  async listConnections(): Promise<ConnectionConfig[]> {
    return loadConns();
  }
  async saveConnection(cfg: ConnectionConfig): Promise<void> {
    const list = loadConns().filter((c) => c.id !== cfg.id);
    list.push(cfg);
    saveConns(list);
  }
  async deleteConnection(id: string): Promise<void> {
    saveConns(loadConns().filter((c) => c.id !== id));
    this.open.get(id)?.close();
    this.open.delete(id);
    await idbDel(id);
  }
  async testConnection(cfg: ConnectionConfig): Promise<void> {
    if (cfg.engine !== "sqlite") throw remoteErr();
  }
  async listDatabases(cfg: ConnectionConfig): Promise<string[]> {
    if (cfg.engine !== "sqlite") throw remoteErr();
    return loadConns().filter((c) => c.engine === "sqlite").map((c) => c.database);
  }
  async createDatabase(cfg: ConnectionConfig): Promise<void> {
    if (cfg.engine !== "sqlite") throw remoteErr();
    // sqlite databases are materialized on first open — nothing to do here.
  }

  async openConnection(id: string): Promise<void> {
    await this.ensureDb(id);
  }
  async closeConnection(id: string): Promise<void> {
    this.open.get(id)?.close();
    this.open.delete(id);
  }

  /* ---- queries ---- */
  async runQuery(connectionId: string, sql: string): Promise<QueryResult> {
    const db = await this.ensureDb(connectionId);
    const started = performance.now();
    let columns: { name: string; dataType: string }[] = [];
    let rows: unknown[][] = [];
    try {
      const res = db.exec(sql);
      if (res.length) {
        const last = res[res.length - 1];
        columns = last.columns.map((name) => ({ name, dataType: "" }));
        rows = last.values as unknown[][];
      } else if (/^\s*(select|with|pragma)\b/i.test(sql)) {
        // SELECT that returned zero rows still has columns — recover them.
        try {
          const st = db.prepare(sql);
          columns = st.getColumnNames().map((name) => ({ name, dataType: "" }));
          st.free();
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      throw queryErr(e);
    }
    const elapsedMs = Math.max(1, Math.round(performance.now() - started));
    const s = sql.trim().toLowerCase();
    if (/^begin\b/.test(s)) this.txn.add(connectionId);
    else if (/^(commit|end|rollback)\b/.test(s)) this.txn.delete(connectionId);
    const isWrite = !/^\s*(select|with|pragma|explain)\b/i.test(sql);
    if (isWrite && !this.txn.has(connectionId)) await this.persist(connectionId);
    return { columns, rows, rowsAffected: db.getRowsModified(), elapsedMs, truncated: false };
  }

  async runQuerySilent(connectionId: string, sql: string): Promise<QueryResult> {
    return this.runQuery(connectionId, sql);
  }

  async cancelQuery(_connectionId: string): Promise<boolean> {
    // sql.js executes synchronously on the browser thread and cannot be
    // interrupted safely once execution has started.
    return false;
  }

  async connectionDiagnostics(connectionId: string) {
    const started = performance.now();
    const db = await this.ensureDb(connectionId);
    const versionResult = db.exec("SELECT sqlite_version()");
    const version = versionResult.length ? String(versionResult[0].values[0]?.[0] ?? "") : "";
    const cfg = (await this.listConnections()).find((item) => item.id === connectionId);
    return {
      serverVersion: version ? `SQLite ${version}` : "SQLite",
      database: cfg?.database ?? "main",
      schema: "main",
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
    };
  }

  async listBackups(_connectionId: string): Promise<BackupInfo[]> {
    throw { kind: "notSupported", message: "Managed backups are provided by the OrbitoDB engine bridge in web mode." } as AppError;
  }

  async createBackup(_connectionId: string): Promise<BackupInfo> {
    throw { kind: "notSupported", message: "Managed backups are provided by the OrbitoDB engine bridge in web mode." } as AppError;
  }

  async restoreBackup(_connectionId: string, _backupId: string): Promise<void> {
    throw { kind: "notSupported", message: "Managed backups are provided by the OrbitoDB engine bridge in web mode." } as AppError;
  }

  async listSchemas(_connectionId: string): Promise<string[]> {
    return ["main", "temp"];
  }

  async listTables(connectionId: string): Promise<TableInfo[]> {
    const db = await this.ensureDb(connectionId);
    const res = db.exec(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const rows = res.length ? res[0].values : [];
    return rows.map((r) => ({ name: String(r[0]), kind: String(r[1]), schema: null }));
  }
  async listDatabaseObjects(connectionId: string): Promise<DatabaseObjectInfo[]> {
    const db = await this.ensureDb(connectionId);
    const res = db.exec(
      "SELECT name, type, tbl_name, sql FROM sqlite_master WHERE type IN ('view','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    );
    const rows = res.length ? res[0].values : [];
    return rows.map((row) => ({
      name: String(row[0] ?? ""),
      kind: String(row[1] ?? "") as DatabaseObjectInfo["kind"],
      schema: "main",
      table: row[2] == null ? null : String(row[2]),
      signature: null,
      definition:
        row[3] == null || String(row[3]).trim() === ""
          ? null
          : String(row[3]).replace(/;?\s*$/, ";"),
    }));
  }

  async listColumns(connectionId: string, table: string): Promise<ColumnInfo[]> {
    const db = await this.ensureDb(connectionId);
    const res = db.exec(`PRAGMA table_xinfo(${q(table)})`);
    const rows = res.length ? res[0].values : [];
    // cid, name, type, notnull, dflt_value, pk, hidden
    return rows.map((r) => {
      const hidden = Number(r[6] ?? 0);
      return {
        name: String(r[1]),
        dataType: r[2] ? String(r[2]) : "",
        nullable: Number(r[3]) === 0,
        isPrimaryKey: Number(r[5]) > 0,
        defaultValue: r[4] == null ? null : String(r[4]),
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
  async listForeignKeys(connectionId: string): Promise<ForeignKey[]> {
    const db = await this.ensureDb(connectionId);
    const tablesRes = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const names = (tablesRes.length ? tablesRes[0].values : []).map((r) => String(r[0]));
    const out: ForeignKey[] = [];
    for (const t of names) {
      const res = db.exec(`PRAGMA foreign_key_list(${q(t)})`);
      const rows = res.length ? res[0].values : [];
      // columns: id, seq, table(ref), from, to, on_update, on_delete, match
      for (const r of rows) {
        out.push({ table: t, column: String(r[3]), refTable: String(r[2]), refColumn: r[4] == null ? "" : String(r[4]) });
      }
    }
    return out;
  }

  async listIndexes(connectionId: string, table: string): Promise<IndexInfo[]> {
    const db = await this.ensureDb(connectionId);
    const res = db.exec(`PRAGMA index_list(${q(table)})`);
    const rows = res.length ? res[0].values : [];
    return rows
      .map((row) => {
        const name = String(row[1] ?? "");
        if (!name) return null;
        const info = db.exec(`PRAGMA index_info(${q(name)})`);
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
        } satisfies IndexInfo;
      })
      .filter((index): index is IndexInfo => index !== null);
  }

  async listConstraints(connectionId: string, table: string): Promise<ConstraintInfo[]> {
    const db = await this.ensureDb(connectionId);
    const out: ConstraintInfo[] = [];
    const pkResult = db.exec(`PRAGMA table_xinfo(${q(table)})`);
    const primary = (pkResult.length ? pkResult[0].values : [])
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

    const indexes = db.exec(`PRAGMA index_list(${q(table)})`);
    for (const row of indexes.length ? indexes[0].values : []) {
      const name = String(row[1] ?? "");
      const origin = row[3] == null ? "" : String(row[3]);
      if (!name || origin !== "u") continue;
      const info = db.exec(`PRAGMA index_info(${q(name)})`);
      const cols = (info.length ? info[0].values : [])
        .map((item) => String(item[2] ?? ""))
        .filter(Boolean);
      out.push({
        name: null,
        kind: "unique",
        definition: `UNIQUE (${cols.join(", ")})`,
        columns: cols,
      });
    }

    const statement = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?");
    try {
      statement.bind([table]);
      if (statement.step()) {
        const createSql = String(statement.get()[0] ?? "");
        for (const expression of sqliteChecks(createSql)) {
          out.push({
            name: null,
            kind: "check",
            definition: `CHECK (${expression})`,
            columns: [],
          });
        }
      }
    } finally {
      statement.free();
    }
    return out;
  }

  async recentHistory(limit: number): Promise<HistoryEntry[]> {
    try {
      const raw = JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]");
      return Array.isArray(raw) ? (raw as HistoryEntry[]).slice(0, limit) : [];
    } catch {
      return [];
    }
  }

  /* ---- row + schema edits ---- */
  async updateCell(connectionId: string, table: string, pkColumn: string, pkValue: unknown, column: string, value: unknown) {
    await this.mutate(connectionId, `UPDATE ${q(table)} SET ${q(column)} = ? WHERE ${q(pkColumn)} = ?`, [value, pkValue]);
  }
  async deleteRow(connectionId: string, table: string, pkColumn: string, pkValue: unknown) {
    await this.mutate(connectionId, `DELETE FROM ${q(table)} WHERE ${q(pkColumn)} = ?`, [pkValue]);
  }
  async insertRow(connectionId: string, table: string, columns: string[], values: unknown[]) {
    if (columns.length === 0) {
      await this.mutate(connectionId, `INSERT INTO ${q(table)} DEFAULT VALUES`);
      return;
    }
    const cols = columns.map(q).join(", ");
    const ph = columns.map(() => "?").join(", ");
    await this.mutate(connectionId, `INSERT INTO ${q(table)} (${cols}) VALUES (${ph})`, values);
  }
  async dropTable(connectionId: string, table: string) {
    await this.mutate(connectionId, `DROP TABLE IF EXISTS ${q(table)}`);
  }
  async createTable(connectionId: string, name: string, columns: ColumnDef[]) {
    const defs = (columns.length ? columns : [{ name: "id", dataType: "INTEGER", nullable: false, primaryKey: true }])
      .map((c) => {
        const parts = [q(c.name), c.dataType || "TEXT"];
        if (c.primaryKey) parts.push("PRIMARY KEY");
        else if (!c.nullable) parts.push("NOT NULL");
        return parts.join(" ");
      })
      .join(", ");
    await this.mutate(connectionId, `CREATE TABLE ${q(name)} (${defs})`);
  }
  async addColumn(connectionId: string, table: string, column: ColumnDef) {
    // NOT NULL without a default fails on a populated table — add as nullable.
    await this.mutate(connectionId, `ALTER TABLE ${q(table)} ADD COLUMN ${q(column.name)} ${column.dataType || "TEXT"}`);
  }
  async dropColumn(connectionId: string, table: string, column: string) {
    await this.mutate(connectionId, `ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`);
  }
  async renameColumn(connectionId: string, table: string, from: string, to: string) {
    await this.mutate(connectionId, `ALTER TABLE ${q(table)} RENAME COLUMN ${q(from)} TO ${q(to)}`);
  }
  async renameTable(connectionId: string, from: string, to: string) {
    await this.mutate(connectionId, `ALTER TABLE ${q(from)} RENAME TO ${q(to)}`);
  }

  /* ---- local database lifecycle ---- */
  async createLocalDatabase(name: string): Promise<ConnectionConfig> {
    const safe = name.trim() || "Local DB";
    const cfg: ConnectionConfig = {
      id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: safe,
      engine: "sqlite",
      database: safe.toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "local",
      host: null,
      port: null,
      username: null,
    };
    await this.saveConnection(cfg);
    await this.ensureDb(cfg.id);
    return cfg;
  }
  async scanLocalDatabases(): Promise<ConnectionConfig[]> {
    return [];
  }
}

export const localBackend: Backend = new LocalBackend();
