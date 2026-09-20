// Web router backend: all engine work — SQLite, PostgreSQL, and MySQL — goes
// through the local engine bridge over HTTP. SQLite database files live in a
// server folder (DATA_DIR) so the same database is shared across browsers,
// tabs, and ports (in-browser IndexedDB storage was per-origin, so it wasn't).
// The connection registry + query history still live in localStorage.
import type { Backend } from "./backend";
import { httpBackend, deleteSecret, saveSecret } from "./http";
import { localBackend } from "./local";
import type { ColumnDef, HistoryEntry } from "./types";

const HIST_KEY = "orbitodb.history";

function assertWebConnection(cfg: import("./types").ConnectionConfig): void {
  if (cfg.ssh?.enabled) {
    throw {
      kind: "notSupported",
      message: "SSH tunnels are available in the OrbitoDB desktop app only.",
    };
  }
}

/** Engine work for every connection goes through the bridge. */
function sub(_id: string): Backend {
  return httpBackend;
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}
let histId = readHistory().reduce((m, h) => Math.max(m, h.id), 0);
function pushHistory(connectionId: string, sql: string): void {
  const list = readHistory();
  list.unshift({ id: ++histId, connectionId, sql, ranAt: new Date().toISOString() });
  if (list.length > 200) list.length = 200;
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export const webBackend: Backend = {
  /* connection registry — always the localStorage-backed local store */
  listConnections: () => localBackend.listConnections(),
  saveConnection: async (cfg, password = null) => {
    await localBackend.saveConnection(cfg, password);
    // Match the desktop/keychain behavior: null means "keep the existing
    // password", while a non-null value explicitly replaces it.
    if (cfg.engine !== "sqlite" && password !== null) await saveSecret(cfg.id, password);
  },
  deleteConnection: async (id) => {
    try {
      await httpBackend.closeConnection(id);
    } catch {
      /* bridge may be down — ignore */
    }
    deleteSecret(id);
    await localBackend.deleteConnection(id);
  },

  /* cfg-driven ops — all engines go through the bridge */
  testConnection: (cfg, password = null) => {
    assertWebConnection(cfg);
    return httpBackend.testConnection(cfg, password);
  },
  listDatabases: (cfg, password = null) => {
    assertWebConnection(cfg);
    return httpBackend.listDatabases(cfg, password);
  },
  createDatabase: (cfg, password, name) => {
    assertWebConnection(cfg);
    return httpBackend.createDatabase(cfg, password, name);
  },

  /* id-driven ops route by the connection's engine */
  openConnection: (id) => {
    const cfg = (() => {
      try {
        const raw = JSON.parse(localStorage.getItem("orbitodb.connections") ?? "[]");
        return Array.isArray(raw) ? raw.find((item) => item?.id === id) : null;
      } catch {
        return null;
      }
    })();
    if (cfg) assertWebConnection(cfg);
    return sub(id).openConnection(id);
  },
  closeConnection: (id) => sub(id).closeConnection(id),
  runQuery: async (id, sql) => {
    const r = await sub(id).runQuery(id, sql);
    pushHistory(id, sql);
    return r;
  },
  runQuerySilent: (id, sql) => sub(id).runQuerySilent(id, sql),
  listSchemas: (id) => sub(id).listSchemas(id),
  listTables: (id) => sub(id).listTables(id),
  listColumns: (id, table) => sub(id).listColumns(id, table),
  listForeignKeys: (id) => sub(id).listForeignKeys(id),
  listIndexes: (id, table) => sub(id).listIndexes(id, table),
  recentHistory: async (limit) => readHistory().slice(0, limit),

  updateCell: (id, table, pkColumn, pkValue, column, value) =>
    sub(id).updateCell(id, table, pkColumn, pkValue, column, value),
  deleteRow: (id, table, pkColumn, pkValue) => sub(id).deleteRow(id, table, pkColumn, pkValue),
  insertRow: (id, table, columns, values) => sub(id).insertRow(id, table, columns, values),
  dropTable: (id, table) => sub(id).dropTable(id, table),
  createTable: (id, name, columns: ColumnDef[]) => sub(id).createTable(id, name, columns),
  addColumn: (id, table, column: ColumnDef) => sub(id).addColumn(id, table, column),
  dropColumn: (id, table, column) => sub(id).dropColumn(id, table, column),
  renameColumn: (id, table, from, to) => sub(id).renameColumn(id, table, from, to),
  renameTable: (id, from, to) => sub(id).renameTable(id, from, to),

  createLocalDatabase: (name) => localBackend.createLocalDatabase(name),
  scanLocalDatabases: () => localBackend.scanLocalDatabases(),
};
