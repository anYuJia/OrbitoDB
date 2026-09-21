import { create } from "zustand";
import { getBackend } from "../ipc/backend";
import { inferColumns } from "../lib/csv";
import { resolveParams } from "../lib/params";
import { quoteIdentifier, selectTableSql } from "../lib/sql";
import { confirmDelete, confirmDialog } from "./dialog";
import { changesSchema, confirmIfDestructive, confirmProdWrite, isWrite } from "./safety";
import { toast } from "./toast";

const READONLY_KEY = "orbitodb.readonly";
function loadReadOnly(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(READONLY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}
import type {
  AppError,
  ColumnDef,
  ColumnInfo,
  ConnectionConfig,
  HistoryEntry,
  QueryResult,
  TableInfo,
} from "../ipc/types";

interface SchemaState {
  tables: TableInfo[];
  columnsByTable: Record<string, ColumnInfo[]>;
}

export type TopView = "data" | "design" | "automation" | "settings";
export type AppScreen = "dashboard" | "workspace";
export type DashPage = "home" | "connections" | "logs";
export type FilterOp = "=" | "!=" | "contains" | ">" | "<";
export interface ViewFilter {
  column: string;
  op: FilterOp;
  value: string;
}
export interface ViewDef {
  id: string;
  connectionId: string;
  table: string;
  name: string;
  filter: ViewFilter | null;
}

/** A saved SQL snippet — used for both the Scripts and Favorites panels. */
export interface SavedItem {
  id: string;
  name: string;
  sql: string;
  savedAt: string;
}

const SCRIPTS_KEY = "orbitodb.scripts";
const FAVS_KEY = "orbitodb.favorites";

function loadSaved(key: string): SavedItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? (raw as SavedItem[]) : [];
  } catch {
    return [];
  }
}

function persistSaved(key: string, items: SavedItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* storage unavailable — keep in memory only */
  }
}

const EDITOR_KEY = "orbitodb.editor";
const LASTCONN_KEY = "orbitodb.lastConn";
const DEFAULT_SQL =
  "-- Create a connection, then write SQL here.\n-- e.g. CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);\nSELECT 1;";

function loadInitialSql(): string {
  try {
    return localStorage.getItem(EDITOR_KEY) ?? DEFAULT_SQL;
  } catch {
    return DEFAULT_SQL;
  }
}
function persistLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** One open SQL editor tab. */
export interface EditorTab {
  id: string;
  name: string;
  sql: string;
}
const EDITORS_KEY = "orbitodb.editors";
const ACTIVE_EDITOR_KEY = "orbitodb.activeEditor";

function loadEditors(): EditorTab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EDITORS_KEY) ?? "null");
    if (Array.isArray(raw) && raw.length) {
      return raw.map((e, i) => ({
        id: String(e.id ?? `ed-${i + 1}`),
        name: String(e.name ?? `Query ${i + 1}`),
        sql: String(e.sql ?? ""),
      }));
    }
  } catch {
    /* fall through to the migrated single editor */
  }
  return [{ id: "ed-1", name: "Query 1", sql: loadInitialSql() }];
}
function persistEditors(editors: EditorTab[], activeId: string): void {
  try {
    localStorage.setItem(EDITORS_KEY, JSON.stringify(editors));
    localStorage.setItem(ACTIVE_EDITOR_KEY, activeId);
  } catch {
    /* ignore */
  }
}
const INITIAL_EDITORS = loadEditors();
const INITIAL_ACTIVE_EDITOR = (() => {
  try {
    const id = localStorage.getItem(ACTIVE_EDITOR_KEY);
    if (id && INITIAL_EDITORS.some((e) => e.id === id)) return id;
  } catch {
    /* ignore */
  }
  return INITIAL_EDITORS[0].id;
})();

/** Apply a saved view's single-condition filter to a row set (client-side). */
function applyViewFilter(rows: unknown[][], columns: { name: string }[], filter: ViewFilter | null): unknown[][] {
  if (!filter) return rows;
  const idx = columns.findIndex((c) => c.name === filter.column);
  if (idx < 0) return rows;
  const target = filter.value;
  const targetNum = Number.parseFloat(target);
  return rows.filter((r) => {
    const s = r[idx] == null ? "" : String(r[idx]);
    switch (filter.op) {
      case "=":
        return s === target;
      case "!=":
        return s !== target;
      case "contains":
        return s.toLowerCase().includes(target.toLowerCase());
      case ">":
        return Number.parseFloat(s) > targetNum;
      case "<":
        return Number.parseFloat(s) < targetNum;
      default:
        return true;
    }
  });
}

export interface AppStore {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  connectingConnectionId: string | null;
  schema: SchemaState;
  sql: string;
  editors: EditorTab[];
  activeEditorId: string;
  editorResults: Record<string, QueryResult | null>;
  editorErrors: Record<string, AppError | null>;
  result: QueryResult | null;
  error: AppError | null;
  running: boolean;
  history: HistoryEntry[];
  editTable: { table: string; pkColumn: string | null } | null;
  openTables: string[];
  detected: ConnectionConfig[];
  loadingTables: boolean;
  loadingResult: boolean;
  view: "data" | "sql" | "history";
  inspectorRow: number | null;
  topView: TopView;
  screen: AppScreen;
  dashPage: DashPage;
  views: ViewDef[];
  activeViewId: string | null;
  selection: number[];
  scripts: SavedItem[];
  favorites: SavedItem[];
  pendingColFilter: { column: string; value: string } | null;
  readOnlyConns: string[];

  loadConnections: () => Promise<void>;
  restoreSession: () => Promise<void>;
  saveConnection: (cfg: ConnectionConfig, password?: string | null) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  openAndIntrospect: (id: string) => Promise<void>;
  expandTable: (table: string) => Promise<void>;
  setSql: (sql: string) => void;
  newEditor: () => void;
  closeEditor: (id: string) => void;
  selectEditor: (id: string) => void;
  setEditorResult: (id: string, result: QueryResult | null, error: AppError | null) => void;
  run: (sqlOverride?: string) => Promise<void>;
  cancelRun: () => void;
  loadHistory: () => Promise<void>;
  openTableData: (table: string, opts?: { newTab?: boolean }) => Promise<void>;
  closeTableTab: (table: string) => void;
  searchTable: (query: string) => Promise<void>;
  navigateFk: (refTable: string, refColumn: string, value: unknown) => Promise<void>;
  setPendingColFilter: (v: { column: string; value: string } | null) => void;
  toggleReadOnly: (id: string) => void;
  autoCommit: boolean;
  txnDirty: boolean;
  txnConnectionId: string | null;
  setAutoCommit: (v: boolean) => void;
  beginTxnIfManual: () => Promise<void>;
  commitTxn: () => Promise<void>;
  rollbackTxn: () => Promise<void>;
  editCell: (rowIndex: number, colIndex: number, value: unknown) => Promise<void>;
  deleteRowAt: (rowIndex: number) => Promise<void>;
  addRow: (columns: string[], values: unknown[]) => Promise<void>;
  dropTable: (table: string) => Promise<void>;
  dropTables: (tables: string[]) => Promise<void>;
  clearTables: (tables: string[]) => Promise<void>;
  createTable: (name: string, columns: ColumnDef[]) => Promise<void>;
  createLocalDatabase: (name: string) => Promise<void>;
  scanLocal: () => Promise<void>;
  addDetected: (cfg: ConnectionConfig) => Promise<void>;
  setView: (v: "data" | "sql" | "history") => void;
  refreshSchema: () => Promise<void>;
  refresh: () => Promise<void>;
  reload: (table: string) => Promise<void>;
  addColumn: (table: string, column: ColumnDef) => Promise<void>;
  dropColumn: (table: string, column: string) => Promise<void>;
  renameColumn: (table: string, from: string, to: string) => Promise<void>;
  renameTable: (from: string, to: string) => Promise<void>;
  importCsv: (table: string, headers: string[], rows: string[][], opts?: { create?: boolean }) => Promise<void>;
  openInspector: (rowIndex: number) => void;
  closeInspector: () => void;
  setTopView: (v: TopView) => void;
  setScreen: (s: AppScreen) => void;
  setDashPage: (p: DashPage) => void;
  addView: (table: string, name: string, filter: ViewFilter | null) => void;
  deleteView: (id: string) => void;
  openView: (view: ViewDef) => Promise<void>;
  toggleRow: (i: number) => void;
  clearSelection: () => void;
  setSelection: (indices: number[]) => void;
  deleteSelected: () => Promise<void>;
  duplicateSelected: () => Promise<void>;
  loadSql: (sql: string) => void;
  showTableDdl: (table: string) => Promise<void>;
  saveScript: (name: string, sql: string) => void;
  deleteScript: (id: string) => void;
  saveFavorite: (name: string, sql: string) => void;
  deleteFavorite: (id: string) => void;
}

const backend = getBackend();
let connectionRequestId = 0;
let dataRequestId = 0;
let queryRequestId = 0;
let beginTxnPromise: Promise<void> | null = null;

/** Disable foreign-key checks (per engine) around an operation, then restore. */
export async function withFkDisabled<T>(id: string, engine: string | undefined, skipFk: boolean, fn: () => Promise<T>): Promise<T> {
  if (!skipFk) return fn();
  const off = engine === "postgres" ? "SET session_replication_role = replica" : engine === "mysql" ? "SET FOREIGN_KEY_CHECKS=0" : "PRAGMA foreign_keys=OFF";
  const on = engine === "postgres" ? "SET session_replication_role = DEFAULT" : engine === "mysql" ? "SET FOREIGN_KEY_CHECKS=1" : "PRAGMA foreign_keys=ON";
  try {
    await backend.runQuery(id, off, { recordHistory: false });
  } catch {
    /* e.g. Postgres needs superuser for this — proceed and let the real error surface */
  }
  try {
    return await fn();
  } finally {
    try {
      await backend.runQuery(id, on, { recordHistory: false });
    } catch {
      /* ignore */
    }
  }
}
/** Heuristic: did an error come from a foreign-key constraint? */
export function isFkError(e: unknown): boolean {
  const m = (e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e)).toLowerCase();
  return m.includes("foreign key");
}

export const useStore = create<AppStore>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  connectingConnectionId: null,
  schema: { tables: [], columnsByTable: {} },
  sql: INITIAL_EDITORS.find((e) => e.id === INITIAL_ACTIVE_EDITOR)?.sql ?? "",
  editors: INITIAL_EDITORS,
  activeEditorId: INITIAL_ACTIVE_EDITOR,
  editorResults: {},
  editorErrors: {},
  result: null,
  error: null,
  running: false,
  history: [],
  editTable: null,
  openTables: [],
  detected: [],
  loadingTables: false,
  loadingResult: false,
  view: "sql",
  inspectorRow: null,
  topView: "data",
  screen: "dashboard",
  dashPage: "home",
  views: [],
  activeViewId: null,
  selection: [],
  scripts: loadSaved(SCRIPTS_KEY),
  favorites: loadSaved(FAVS_KEY),
  pendingColFilter: null,
  readOnlyConns: loadReadOnly(),

  toggleReadOnly: (id) =>
    set((s) => {
      const readOnlyConns = s.readOnlyConns.includes(id)
        ? s.readOnlyConns.filter((x) => x !== id)
        : [...s.readOnlyConns, id];
      try {
        localStorage.setItem(READONLY_KEY, JSON.stringify(readOnlyConns));
      } catch {
        /* ignore */
      }
      toast(readOnlyConns.includes(id) ? "Read-only mode on — writes are blocked." : "Read-only mode off.", "info");
      return { readOnlyConns };
    }),

  autoCommit: true,
  txnDirty: false,
  txnConnectionId: null,

  setAutoCommit: (v) => {
    if (!v) {
      set({ autoCommit: false });
      toast("Manual commit — writes run in a transaction until you commit.", "info");
      return;
    }
    void (async () => {
      if (get().txnDirty) await get().commitTxn();
      if (get().txnDirty) return;
      set({ autoCommit: true });
      toast("Auto-commit on.", "info");
    })();
  },

  beginTxnIfManual: async () => {
    if (beginTxnPromise) return beginTxnPromise;
    const { autoCommit, txnDirty, activeConnectionId } = get();
    if (autoCommit || txnDirty || !activeConnectionId) return;
    beginTxnPromise = (async () => {
      if (get().autoCommit || get().txnDirty) return;
      set({ txnDirty: true, txnConnectionId: activeConnectionId });
      try {
        await backend.runQuery(activeConnectionId, "BEGIN", { recordHistory: false });
      } catch (error) {
        set({ txnDirty: false, txnConnectionId: null });
        throw error;
      }
    })();
    try {
      await beginTxnPromise;
    } finally {
      beginTxnPromise = null;
    }
  },

  commitTxn: async () => {
    const { txnDirty, txnConnectionId } = get();
    if (!txnDirty || !txnConnectionId) return;
    try {
      await backend.runQuery(txnConnectionId, "COMMIT", { recordHistory: false });
      set({ txnDirty: false, txnConnectionId: null });
      toast("Transaction committed.", "success");
    } catch (e) {
      toast(normalizeError(e).message ?? "Commit failed", "error");
    }
  },

  rollbackTxn: async () => {
    const { txnDirty, txnConnectionId, activeConnectionId, editTable } = get();
    if (!txnDirty || !txnConnectionId) return;
    try {
      await backend.runQuery(txnConnectionId, "ROLLBACK", { recordHistory: false });
      set({ txnDirty: false, txnConnectionId: null });
      toast("Transaction rolled back.", "info");
      await get().refreshSchema();
      if (editTable && activeConnectionId === txnConnectionId) await get().reload(editTable.table);
    } catch (e) {
      toast(normalizeError(e).message ?? "Rollback failed", "error");
    }
  },

  loadConnections: async () => {
    set({ connections: await backend.listConnections() });
  },

  restoreSession: async () => {
    await get().loadConnections();
    let lastId: string | null = null;
    try {
      lastId = localStorage.getItem(LASTCONN_KEY);
    } catch {
      /* ignore */
    }
    if (lastId && get().activeConnectionId == null && get().connections.some((c) => c.id === lastId)) {
      await get().openAndIntrospect(lastId);
    }
  },

  saveConnection: async (cfg, password = null) => {
    await backend.saveConnection(cfg, password);
    await get().loadConnections();
  },

  deleteConnection: async (id) => {
    if (get().running && get().activeConnectionId === id) {
      toast("Stop or finish the running query before deleting this connection.", "error");
      return;
    }
    if (get().txnDirty && get().txnConnectionId === id) await get().rollbackTxn();
    if (get().txnDirty && get().txnConnectionId === id) {
      toast("Roll back or commit the open transaction before deleting this connection.", "error");
      return;
    }
    const wasActive = get().activeConnectionId === id;
    const wasConnecting = get().connectingConnectionId === id;
    if (wasActive || wasConnecting) {
      connectionRequestId += 1;
      dataRequestId += 1;
      set({ connectingConnectionId: null, loadingTables: false, loadingResult: false });
    }
    try {
      await backend.deleteConnection(id);
    } catch (error) {
      const err = normalizeError(error);
      set({
        activeConnectionId: wasConnecting && get().activeConnectionId === id ? null : get().activeConnectionId,
        error: err,
      });
      toast(err.message ?? "Could not delete connection", "error");
      return;
    }
    if (get().activeConnectionId === id) {
      set({
        activeConnectionId: null,
        connectingConnectionId: null,
        schema: { tables: [], columnsByTable: {} },
        editTable: null,
        openTables: [],
        result: null,
        error: null,
        loadingTables: false,
        loadingResult: false,
        inspectorRow: null,
        activeViewId: null,
        selection: [],
      });
    }
    try {
      if (localStorage.getItem(LASTCONN_KEY) === id) localStorage.removeItem(LASTCONN_KEY);
    } catch {
      /* ignore */
    }
    if (get().txnConnectionId === id) set({ txnDirty: false, txnConnectionId: null });
    set((s) => {
      const readOnlyConns = s.readOnlyConns.filter((connectionId) => connectionId !== id);
      const activeViewDeleted = s.views.some(
        (view) => view.id === s.activeViewId && view.connectionId === id,
      );
      try {
        localStorage.setItem(READONLY_KEY, JSON.stringify(readOnlyConns));
      } catch {
        /* ignore */
      }
      return {
        readOnlyConns,
        views: s.views.filter((view) => view.connectionId !== id),
        activeViewId: activeViewDeleted ? null : s.activeViewId,
      };
    });
    await get().loadConnections();
  },

  openAndIntrospect: async (id) => {
    const { txnDirty, txnConnectionId, running } = get();
    if (running) {
      toast("Stop or finish the running query before switching connections.", "error");
      return;
    }
    if (txnDirty && txnConnectionId) {
      const action = txnConnectionId === id ? "reconnecting" : "switching connections";
      toast(`Commit or roll back the open transaction before ${action}.`, "error");
      return;
    }
    const requestId = ++connectionRequestId;
    dataRequestId += 1;
    // Reset everything tied to the previous source so its tables/data don't
    // bleed through while the new source introspects (or if it errors).
    set({
      activeConnectionId: id,
      connectingConnectionId: id,
      loadingTables: true,
      loadingResult: false,
      error: null,
      schema: { tables: [], columnsByTable: {} },
      editTable: null,
      openTables: [],
      result: null,
      view: "sql",
      activeViewId: null,
      selection: [],
      inspectorRow: null,
    });
    try {
      await backend.openConnection(id);
      if (requestId !== connectionRequestId) return;
      const tables = await backend.listTables(id);
      if (requestId !== connectionRequestId) return;
      persistLocal(LASTCONN_KEY, id);
      set({ schema: { tables, columnsByTable: {} }, loadingTables: false, connectingConnectionId: null });
      // Eagerly cache columns for small schemas so SQL autocomplete has them.
      if (tables.length <= 40) {
        void (async () => {
          const cols: Record<string, ColumnInfo[]> = {};
          for (const t of tables) {
            if (requestId !== connectionRequestId || get().activeConnectionId !== id) return;
            try {
              cols[t.name] = await backend.listColumns(id, t.name);
            } catch {
              /* best-effort */
            }
          }
          if (requestId === connectionRequestId && get().activeConnectionId === id) {
            set((s) => ({
              schema: { ...s.schema, columnsByTable: { ...s.schema.columnsByTable, ...cols } },
            }));
          }
        })();
      }
    } catch (e) {
      if (requestId !== connectionRequestId) return;
      const err = normalizeError(e);
      set({
        activeConnectionId: null,
        connectingConnectionId: null,
        schema: { tables: [], columnsByTable: {} },
        editTable: null,
        openTables: [],
        result: null,
        error: err,
        loadingTables: false,
        loadingResult: false,
      });
      try {
        if (localStorage.getItem(LASTCONN_KEY) === id) localStorage.removeItem(LASTCONN_KEY);
      } catch {
        /* ignore */
      }
      toast(err.message ?? "Could not open connection", "error");
    }
  },

  expandTable: async (table) => {
    const id = get().activeConnectionId;
    if (!id || get().schema.columnsByTable[table]) return;
    const requestId = connectionRequestId;
    const cols = await backend.listColumns(id, table);
    if (requestId !== connectionRequestId || get().activeConnectionId !== id) return;
    set((s) => ({
      schema: {
        ...s.schema,
        columnsByTable: { ...s.schema.columnsByTable, [table]: cols },
      },
    }));
  },

  setSql: (sql) =>
    set((s) => {
      const editors = s.editors.map((e) => (e.id === s.activeEditorId ? { ...e, sql } : e));
      persistEditors(editors, s.activeEditorId);
      return { sql, editors };
    }),

  newEditor: () =>
    set((s) => {
      const id = `ed-${Date.now().toString(36)}`;
      const editor: EditorTab = { id, name: `Query ${s.editors.length + 1}`, sql: "" };
      const editors = [...s.editors, editor];
      persistEditors(editors, id);
      return { editors, activeEditorId: id, sql: "", view: "sql", topView: "data" };
    }),

  selectEditor: (id) =>
    set((s) => {
      const ed = s.editors.find((e) => e.id === id);
      if (!ed) return {};
      persistEditors(s.editors, id);
      return { activeEditorId: id, sql: ed.sql, view: "sql", topView: "data" };
    }),

  showTableDdl: async (table) => {
    const id = get().activeConnectionId;
    if (!id) return;
    const requestId = connectionRequestId;
    const engine = get().connections.find((connection) => connection.id === id)?.engine;
    let cols = get().schema.columnsByTable[table];
    if (!cols) {
      try {
        cols = await backend.listColumns(id, table);
      } catch {
        cols = [];
      }
    }
    if (requestId !== connectionRequestId || get().activeConnectionId !== id) return;
    const quote = (name: string) => quoteIdentifier(name, engine);
    const lines = cols.map((c) => {
      let s = `  ${quote(c.name)} ${c.dataType || "TEXT"}`;
      if (c.isPrimaryKey) s += " PRIMARY KEY";
      else if (!c.nullable) s += " NOT NULL";
      return s;
    });
    const ddl = lines.length
      ? `CREATE TABLE ${quote(table)} (\n${lines.join(",\n")}\n);`
      : `-- No column information available for ${table}`;
    get().newEditor();
    get().setSql(ddl);
  },

  closeEditor: (id) =>
    set((s) => {
      const idx = s.editors.findIndex((e) => e.id === id);
      let editors = s.editors.filter((e) => e.id !== id);
      const editorResults = { ...s.editorResults };
      const editorErrors = { ...s.editorErrors };
      delete editorResults[id];
      delete editorErrors[id];
      if (editors.length === 0) {
        const fresh: EditorTab = { id: `ed-${Date.now().toString(36)}`, name: "Query 1", sql: "" };
        editors = [fresh];
        persistEditors(editors, fresh.id);
        return { editors, activeEditorId: fresh.id, sql: "", editorResults, editorErrors };
      }
      let activeEditorId = s.activeEditorId;
      let sql = s.sql;
      if (id === s.activeEditorId) {
        const next = editors[Math.min(idx, editors.length - 1)];
        activeEditorId = next.id;
        sql = next.sql;
      }
      persistEditors(editors, activeEditorId);
      return { editors, activeEditorId, sql, editorResults, editorErrors };
    }),

  setEditorResult: (id, result, error) =>
    set((s) => ({
      editorResults: { ...s.editorResults, [id]: result },
      editorErrors: { ...s.editorErrors, [id]: error },
    })),

  run: async (sqlOverride) => {
    const { activeConnectionId, sql, activeEditorId, readOnlyConns, running } = get();
    const requestedSql = sqlOverride ?? sql;
    if (running) return;
    if (!activeConnectionId) {
      const err: AppError = { kind: "notConnected", message: "Open a connection first." };
      get().setEditorResult(activeEditorId, null, err);
      set({ error: err });
      toast(err.message ?? "Open a connection first.", "error");
      return;
    }
    if (!requestedSql.trim()) {
      toast("Write a query before running it.", "info");
      return;
    }
    if (readOnlyConns.includes(activeConnectionId) && isWrite(requestedSql)) {
      toast("Connection is read-only — writes are blocked.", "error");
      return;
    }
    const conn = get().connections.find((c) => c.id === activeConnectionId);
    const requestId = ++queryRequestId;
    set({ running: true, view: "sql", topView: "data", error: null });
    get().setEditorResult(activeEditorId, get().editorResults[activeEditorId] ?? null, null);
    let finalSql: string | null = null;
    try {
      if (!(await confirmProdWrite(conn, requestedSql))) return;
      if (requestId !== queryRequestId) return;
      finalSql = await resolveParams(requestedSql);
      if (finalSql == null) return;
      if (requestId !== queryRequestId) return;
      if (!(await confirmIfDestructive(finalSql))) return;
      if (requestId !== queryRequestId) return;
      if (isWrite(finalSql)) await get().beginTxnIfManual();
      if (requestId !== queryRequestId) return;
      const result = await backend.runQuery(activeConnectionId, finalSql);
      if (requestId !== queryRequestId) return;
      get().setEditorResult(activeEditorId, result, null);
      if (changesSchema(finalSql)) await get().refreshSchema();
      await get().loadHistory();
    } catch (e) {
      if (requestId !== queryRequestId) return;
      // If a foreign-key constraint blocked it, offer to retry with FK checks off.
      if (
        finalSql &&
        isFkError(e) &&
        !get().txnDirty &&
        (await confirmDialog({
          title: "Foreign key constraint failed",
          message: "Other rows reference this data, so the statement was blocked. Retry with foreign-key checks disabled?",
          confirmLabel: "Retry, skip FK checks",
          danger: true,
        }))
      ) {
        const retrySql = finalSql;
        try {
          const result = await withFkDisabled(activeConnectionId, conn?.engine, true, () =>
            backend.runQuery(activeConnectionId, retrySql),
          );
          if (requestId !== queryRequestId) return;
          get().setEditorResult(activeEditorId, result, null);
          await get().loadHistory();
          return;
        } catch (e2) {
          if (requestId !== queryRequestId) return;
          const err2 = normalizeError(e2);
          get().setEditorResult(activeEditorId, null, err2);
          toast(err2.message ?? "Query failed", "error");
          return;
        }
      }
      const err = normalizeError(e);
      get().setEditorResult(activeEditorId, null, err);
      toast(err.message ?? "Query failed", "error");
    } finally {
      if (requestId === queryRequestId) set({ running: false });
    }
  },

  cancelRun: () => {
    if (!get().running) return;
    queryRequestId += 1;
    set({ running: false });
    toast("Stopped waiting for the query. The database may still finish it in the background.", "info");
  },

  loadHistory: async () => {
    set({ history: await backend.recentHistory(50) });
  },

  navigateFk: async (refTable, refColumn, value) => {
    set({ pendingColFilter: { column: refColumn, value: value == null ? "" : String(value) } });
    await get().openTableData(refTable);
  },

  setPendingColFilter: (v) => set({ pendingColFilter: v }),

  openTableData: async (table, opts) => {
    const id = get().activeConnectionId;
    if (!id) return;
    const requestId = ++dataRequestId;
    // Maintain the open-table tab list. Ctrl/Cmd-click (newTab) appends a tab;
    // a plain click replaces the active table tab so casual browsing doesn't pile
    // up tabs. An already-open table is just re-activated.
    const { openTables, editTable, view, connections } = get();
    let nextTabs: string[];
    if (openTables.includes(table)) {
      nextTabs = openTables;
    } else if (opts?.newTab) {
      nextTabs = [...openTables, table];
    } else if (editTable && view === "data" && openTables.includes(editTable.table)) {
      nextTabs = openTables.map((t) => (t === editTable.table ? table : t));
    } else {
      nextTabs = [...openTables, table];
    }
    const engine = connections.find((connection) => connection.id === id)?.engine;
    const sql = selectTableSql(table, engine);
    set({
      view: "data",
      topView: "data",
      loadingResult: true,
      error: null,
      editTable: { table, pkColumn: null },
      openTables: nextTabs,
      inspectorRow: null,
      activeViewId: null,
      selection: [],
    });
    try {
      // Column introspection is best-effort — it must never block the data load.
      try {
        await get().expandTable(table);
      } catch {
        /* fall back to the columns the query itself returns */
      }
      if (requestId !== dataRequestId || get().activeConnectionId !== id) return;
      const cols = get().schema.columnsByTable[table] ?? [];
      const pkColumn = cols.find((c) => c.isPrimaryKey)?.name ?? null;
      let result = await backend.runQuery(id, sql, { recordHistory: false });
      // Empty tables yield no columns from the row set — show the schema's columns.
      if (result.columns.length === 0 && cols.length > 0) {
        result = { ...result, columns: cols.map((c) => ({ name: c.name, dataType: c.dataType })) };
      }
      if (requestId !== dataRequestId || get().activeConnectionId !== id) return;
      set({ result, editTable: { table, pkColumn }, loadingResult: false });
      await get().loadHistory();
    } catch (e) {
      if (requestId !== dataRequestId || get().activeConnectionId !== id) return;
      set({ error: normalizeError(e), result: null, loadingResult: false });
    }
  },

  closeTableTab: (table) => {
    const { openTables, editTable } = get();
    const idx = openTables.indexOf(table);
    if (idx === -1) return;
    const next = openTables.filter((t) => t !== table);
    set({ openTables: next });
    // If the closed tab was the active one, fall back to a neighbour (or the editor).
    if (editTable?.table === table) {
      if (next.length) void get().openTableData(next[Math.min(idx, next.length - 1)]);
      else {
        dataRequestId += 1;
        set({ editTable: null, result: null, loadingResult: false, view: "sql", selection: [], inspectorRow: null });
      }
    }
  },

  // Whole-table search: filters EVERY row of the active table on the server (not
  // just the rows already loaded into the grid), across all columns. Engine-aware
  // casting/quoting so it works on SQLite, PostgreSQL and MySQL.
  searchTable: async (query) => {
    const { activeConnectionId, editTable, result, connections } = get();
    if (!activeConnectionId || !editTable) return;
    const cols = (result?.columns ?? []).map((c) => c.name);
    if (!cols.length) return;
    const requestId = ++dataRequestId;
    const engine = connections.find((c) => c.id === activeConnectionId)?.engine;
    const qid = (name: string) => quoteIdentifier(name, engine);
    const toText = (e: string) => (engine === "mysql" ? `CAST(${e} AS CHAR)` : `CAST(${e} AS TEXT)`);
    const lit = `'%${query.replace(/'/g, "''")}%'`;
    const where = cols.map((c) => `${toText(qid(c))} LIKE ${lit}`).join(" OR ");
    const from = qid(editTable.table);
    set({ loadingResult: true, error: null });
    try {
      let next = await backend.runQuery(activeConnectionId, `SELECT * FROM ${from} WHERE ${where} LIMIT 1000;`, { recordHistory: false });
      if (requestId !== dataRequestId || get().activeConnectionId !== activeConnectionId || get().editTable?.table !== editTable.table) return;
      if (next.columns.length === 0 && result?.columns.length) next = { ...next, columns: result.columns };
      set({ result: next, loadingResult: false, selection: [], inspectorRow: null });
    } catch (e) {
      if (requestId !== dataRequestId || get().activeConnectionId !== activeConnectionId) return;
      set({ error: normalizeError(e), loadingResult: false });
    }
  },

  editCell: async (rowIndex, colIndex, value) => {
    const { activeConnectionId, result, editTable } = get();
    if (!activeConnectionId || !result || !editTable?.pkColumn) return;
    if (get().readOnlyConns.includes(activeConnectionId)) return toast("Read-only — writes are blocked.", "error");
    const pkIdx = result.columns.findIndex((c) => c.name === editTable.pkColumn);
    if (pkIdx < 0) return;
    const pkValue = result.rows[rowIndex][pkIdx];
    const column = result.columns[colIndex].name;
    const conn = get().connections.find((connection) => connection.id === activeConnectionId);
    if (!(await confirmProdWrite(conn, "UPDATE"))) return;
    try {
      await get().beginTxnIfManual();
      await backend.updateCell(
        activeConnectionId,
        editTable.table,
        editTable.pkColumn,
        pkValue,
        column,
        value,
      );
      if (
        get().activeConnectionId !== activeConnectionId ||
        get().editTable?.table !== editTable.table
      ) return;
      const rows = result.rows.map((r, i) =>
        i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : r,
      );
      set({ result: { ...result, rows }, error: null });
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  deleteRowAt: async (rowIndex) => {
    const { activeConnectionId, result, editTable } = get();
    if (!activeConnectionId || !result || !editTable?.pkColumn) return;
    if (get().readOnlyConns.includes(activeConnectionId)) return toast("Read-only — writes are blocked.", "error");
    const pkIdx = result.columns.findIndex((c) => c.name === editTable.pkColumn);
    if (pkIdx < 0) return;
    const pkValue = result.rows[rowIndex][pkIdx];
    const pkColumn = editTable.pkColumn;
    const choice = await confirmDelete({
      title: "Delete row?",
      message: `Delete the row where ${pkColumn} = ${String(pkValue)}? This can't be undone.`,
      confirmLabel: "Delete",
    });
    if (!choice.ok) return;
    const engine = get().connections.find((c) => c.id === activeConnectionId)?.engine;
    const conn = get().connections.find((connection) => connection.id === activeConnectionId);
    if (!(await confirmProdWrite(conn, "DELETE"))) return;
    try {
      if (choice.skipFk && !get().autoCommit) {
        if (get().txnDirty) {
          toast("Commit or roll back the open transaction before bypassing foreign-key checks.", "error");
          return;
        }
        toast("Force delete runs outside the manual transaction so foreign-key checks can be restored.", "info");
      } else {
        await get().beginTxnIfManual();
      }
      await withFkDisabled(activeConnectionId, engine, choice.skipFk, () =>
        backend.deleteRow(activeConnectionId, editTable.table, pkColumn, pkValue),
      );
      if (
        get().activeConnectionId !== activeConnectionId ||
        get().editTable?.table !== editTable.table
      ) return;
      const rows = result.rows.filter((_, i) => i !== rowIndex);
      set((s) => ({
        result: { ...result, rows },
        error: null,
        inspectorRow:
          s.inspectorRow === null || s.inspectorRow === rowIndex
            ? null
            : s.inspectorRow > rowIndex
              ? s.inspectorRow - 1
              : s.inspectorRow,
      }));
    } catch (e) {
      set({ error: normalizeError(e) });
      toast(
        isFkError(e) ? "Delete blocked by a foreign key. Try again and tick “Skip foreign-key checks”." : normalizeError(e).message ?? "Delete failed",
        "error",
      );
    }
  },

  addRow: async (columns, values) => {
    const { activeConnectionId, editTable } = get();
    if (!activeConnectionId || !editTable) return;
    if (get().readOnlyConns.includes(activeConnectionId)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((connection) => connection.id === activeConnectionId);
    if (!(await confirmProdWrite(conn, "INSERT"))) return;
    try {
      await get().beginTxnIfManual();
      await backend.insertRow(activeConnectionId, editTable.table, columns, values);
      if (
        get().activeConnectionId !== activeConnectionId ||
        get().editTable?.table !== editTable.table
      ) return;
      await get().openTableData(editTable.table); // refresh to show the new row + its PK
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  dropTable: async (table) => {
    const id = get().activeConnectionId;
    if (!id) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((connection) => connection.id === id);
    if (!(await confirmProdWrite(conn, "DROP TABLE"))) return;
    try {
      await backend.dropTable(id, table);
      const tables = await backend.listTables(id);
      if (get().activeConnectionId !== id) {
        set((s) => ({
          views: s.views.filter((view) => !(view.connectionId === id && view.table === table)),
        }));
        return;
      }
      dataRequestId += 1;
      set((s) => ({
        schema: { tables, columnsByTable: {} },
        error: null,
        editTable: s.editTable?.table === table ? null : s.editTable,
        result: s.editTable?.table === table ? null : s.result,
        openTables: s.openTables.filter((name) => name !== table),
        views: s.views.filter((view) => !(view.connectionId === id && view.table === table)),
        activeViewId: s.editTable?.table === table ? null : s.activeViewId,
        selection: s.editTable?.table === table ? [] : s.selection,
        inspectorRow: s.editTable?.table === table ? null : s.inspectorRow,
      }));
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  dropTables: async (names) => {
    const id = get().activeConnectionId;
    if (!id || names.length === 0) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const label = names.length === 1 ? `“${names[0]}”` : `${names.length} tables`;
    const choice = await confirmDelete({
      title: names.length === 1 ? "Drop table?" : `Drop ${names.length} tables?`,
      message: `This permanently deletes ${label} and all rows in ${names.length === 1 ? "it" : "them"}. This can't be undone.`,
      confirmLabel: names.length === 1 ? "Drop" : "Drop all",
    });
    if (!choice.ok) return;
    const conn = get().connections.find((c) => c.id === id);
    if (!(await confirmProdWrite(conn, "DROP"))) return;
    try {
      if (choice.skipFk && !get().autoCommit) {
        if (get().txnDirty) {
          toast("Commit or roll back the open transaction before bypassing foreign-key checks.", "error");
          return;
        }
        toast("Force drop runs outside the manual transaction so foreign-key checks can be restored.", "info");
      }
      await withFkDisabled(id, conn?.engine, choice.skipFk, async () => {
        for (const n of names) await backend.dropTable(id, n);
      });
      const tables = await backend.listTables(id);
      if (get().activeConnectionId !== id) {
        set((s) => ({
          views: s.views.filter((view) => !(view.connectionId === id && names.includes(view.table))),
        }));
        return;
      }
      dataRequestId += 1;
      set((s) => ({
        schema: { tables, columnsByTable: {} },
        error: null,
        editTable: s.editTable && names.includes(s.editTable.table) ? null : s.editTable,
        result: s.editTable && names.includes(s.editTable.table) ? null : s.result,
        openTables: s.openTables.filter((name) => !names.includes(name)),
        views: s.views.filter((view) => !(view.connectionId === id && names.includes(view.table))),
        activeViewId: s.editTable && names.includes(s.editTable.table) ? null : s.activeViewId,
        selection: s.editTable && names.includes(s.editTable.table) ? [] : s.selection,
        inspectorRow: s.editTable && names.includes(s.editTable.table) ? null : s.inspectorRow,
      }));
      toast(`Dropped ${names.length} ${names.length === 1 ? "table" : "tables"}.`, "success");
    } catch (e) {
      const err = normalizeError(e);
      set({ error: err });
      toast(
        isFkError(e) ? "Drop blocked by a foreign key. Try again and tick “Skip foreign-key checks”." : err.message ?? "Drop failed",
        "error",
      );
    }
  },

  clearTables: async (names) => {
    const id = get().activeConnectionId;
    if (!id || names.length === 0) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const label = names.length === 1 ? `“${names[0]}”` : `${names.length} tables`;
    const choice = await confirmDelete({
      title: names.length === 1 ? "Clear table?" : `Clear ${names.length} tables?`,
      message: `This deletes every row from ${label} but keeps the table structure. This can't be undone.`,
      confirmLabel: "Clear rows",
    });
    if (!choice.ok) return;
    const conn = get().connections.find((c) => c.id === id);
    if (!(await confirmProdWrite(conn, "DELETE"))) return;
    const q = (n: string) => (conn?.engine === "mysql" ? `\`${n.replace(/`/g, "``")}\`` : `"${n.replace(/"/g, '""')}"`);
    try {
      if (choice.skipFk && !get().autoCommit) {
        if (get().txnDirty) {
          toast("Commit or roll back the open transaction before bypassing foreign-key checks.", "error");
          return;
        }
        toast("Force clear runs outside the manual transaction so foreign-key checks can be restored.", "info");
      } else {
        await get().beginTxnIfManual();
      }
      await withFkDisabled(id, conn?.engine, choice.skipFk, async () => {
        for (const n of names) await backend.runQuery(id, `DELETE FROM ${q(n)}`, { recordHistory: false });
      });
      if (get().activeConnectionId !== id) return;
      const et = get().editTable;
      if (et && names.includes(et.table)) await get().reload(et.table);
      toast(`Cleared ${names.length} ${names.length === 1 ? "table" : "tables"}.`, "success");
    } catch (e) {
      const err = normalizeError(e);
      set({ error: err });
      toast(
        isFkError(e) ? "Clear blocked by a foreign key. Try again and tick “Skip foreign-key checks”." : err.message ?? "Clear failed",
        "error",
      );
    }
  },

  createTable: async (name, columns) => {
    const id = get().activeConnectionId;
    if (!id) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((connection) => connection.id === id);
    if (!(await confirmProdWrite(conn, "CREATE TABLE"))) return;
    try {
      await backend.createTable(id, name, columns);
      const tables = await backend.listTables(id);
      if (get().activeConnectionId !== id) return;
      set({ schema: { tables, columnsByTable: {} }, error: null });
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  createLocalDatabase: async (name) => {
    try {
      const cfg = await backend.createLocalDatabase(name);
      await get().loadConnections();
      await get().openAndIntrospect(cfg.id);
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  scanLocal: async () => {
    try {
      set({ detected: await backend.scanLocalDatabases() });
    } catch {
      set({ detected: [] });
    }
  },

  addDetected: async (cfg) => {
    try {
      await backend.saveConnection(cfg, null);
      await get().loadConnections();
      await get().openAndIntrospect(cfg.id);
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  setView: (v) => set({ view: v }),

  refreshSchema: async () => {
    const id = get().activeConnectionId;
    if (!id) return;
    const requestId = connectionRequestId;
    try {
      const tables = await backend.listTables(id);
      if (requestId !== connectionRequestId || get().activeConnectionId !== id) return;
      set({ schema: { tables, columnsByTable: {} }, error: null });
    } catch (e) {
      if (requestId !== connectionRequestId || get().activeConnectionId !== id) return;
      set({ error: normalizeError(e) });
    }
  },

  refresh: async () => {
    const t = get().editTable?.table;
    if (t) await get().openTableData(t);
  },

  reload: async (table) => {
    const id = get().activeConnectionId;
    if (!id) return;
    const requestId = connectionRequestId;
    const tables = await backend.listTables(id);
    if (requestId !== connectionRequestId || get().activeConnectionId !== id) return;
    set((s) => {
      const columnsByTable = { ...s.schema.columnsByTable };
      delete columnsByTable[table];
      return { schema: { tables, columnsByTable } };
    });
    await get().openTableData(table);
  },

  addColumn: async (table, column) => {
    const id = get().activeConnectionId;
    if (!id) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((connection) => connection.id === id);
    if (!(await confirmProdWrite(conn, "ALTER TABLE"))) return;
    try {
      await backend.addColumn(id, table, column);
      if (get().activeConnectionId !== id) return;
      await get().reload(table);
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  dropColumn: async (table, column) => {
    const id = get().activeConnectionId;
    if (!id) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((connection) => connection.id === id);
    if (!(await confirmProdWrite(conn, "ALTER TABLE"))) return;
    try {
      await backend.dropColumn(id, table, column);
      if (get().activeConnectionId !== id) return;
      await get().reload(table);
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  renameColumn: async (table, from, to) => {
    const id = get().activeConnectionId;
    if (!id) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((connection) => connection.id === id);
    if (!(await confirmProdWrite(conn, "ALTER TABLE"))) return;
    try {
      await backend.renameColumn(id, table, from, to);
      if (get().activeConnectionId !== id) return;
      await get().reload(table);
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  renameTable: async (from, to) => {
    const id = get().activeConnectionId;
    if (!id) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((connection) => connection.id === id);
    if (!(await confirmProdWrite(conn, "ALTER TABLE"))) return;
    try {
      await backend.renameTable(id, from, to);
      const tables = await backend.listTables(id);
      if (get().activeConnectionId !== id) {
        set((s) => ({
          views: s.views.map((view) =>
            view.connectionId === id && view.table === from ? { ...view, table: to } : view,
          ),
        }));
        return;
      }
      dataRequestId += 1;
      set((s) => ({
        schema: { tables, columnsByTable: {} },
        error: null,
        openTables: s.openTables.map((table) => (table === from ? to : table)),
        views: s.views.map((view) =>
          view.connectionId === id && view.table === from ? { ...view, table: to } : view,
        ),
      }));
      await get().openTableData(to);
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  importCsv: async (table, headers, rows, opts) => {
    const id = get().activeConnectionId;
    if (!id) return;
    if (get().readOnlyConns.includes(id)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((c) => c.id === id);
    if (!(await confirmProdWrite(conn, "INSERT"))) return;
    try {
      if (opts?.create) {
        await backend.createTable(id, table, inferColumns(headers, rows));
        if (get().activeConnectionId !== id) {
          toast("Import stopped because the active connection changed.", "error");
          return;
        }
      }
      await get().beginTxnIfManual();
      for (const r of rows) await backend.insertRow(id, table, headers, r);
      if (get().activeConnectionId === id) {
        if (opts?.create) {
          await get().refreshSchema();
          await get().openTableData(table);
        } else {
          await get().reload(table);
        }
      }
      toast(`Imported ${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"} into ${table}`, "success");
    } catch (e) {
      const err = normalizeError(e);
      set({ error: err });
      toast(err.message ?? "Import failed", "error");
    }
  },

  openInspector: (rowIndex) => set({ inspectorRow: rowIndex }),
  closeInspector: () => set({ inspectorRow: null }),

  setTopView: (v) => set({ topView: v }),

  setScreen: (s) => set({ screen: s }),

  setDashPage: (p) => set({ dashPage: p, screen: "dashboard" }),

  addView: (table, name, filter) => {
    const id = get().activeConnectionId;
    if (!id) return;
    const view: ViewDef = {
      id: `view-${id}-${table}-${get().views.length + 1}-${name.replace(/\s+/g, "_")}`,
      connectionId: id,
      table,
      name,
      filter,
    };
    set((s) => ({ views: [...s.views, view] }));
    void get().openView(view);
  },

  deleteView: (id) => {
    set((s) => ({
      views: s.views.filter((v) => v.id !== id),
      activeViewId: s.activeViewId === id ? null : s.activeViewId,
    }));
  },

  openView: async (view) => {
    const id = get().activeConnectionId;
    if (!id || id !== view.connectionId) return;
    const requestId = ++dataRequestId;
    const engine = get().connections.find((connection) => connection.id === id)?.engine;
    const sql = selectTableSql(view.table, engine, 200);
    set({
      view: "data",
      topView: "data",
      loadingResult: true,
      error: null,
      editTable: { table: view.table, pkColumn: null },
      inspectorRow: null,
      activeViewId: view.id,
      selection: [],
    });
    try {
      try {
        await get().expandTable(view.table);
      } catch {
        /* fall back to query columns */
      }
      if (requestId !== dataRequestId || get().activeConnectionId !== id) return;
      const cols = get().schema.columnsByTable[view.table] ?? [];
      const pkColumn = cols.find((c) => c.isPrimaryKey)?.name ?? null;
      let result = await backend.runQuery(id, sql, { recordHistory: false });
      if (result.columns.length === 0 && cols.length > 0) {
        result = { ...result, columns: cols.map((c) => ({ name: c.name, dataType: c.dataType })) };
      }
      result = { ...result, rows: applyViewFilter(result.rows, result.columns, view.filter) };
      if (requestId !== dataRequestId || get().activeConnectionId !== id) return;
      set({ result, editTable: { table: view.table, pkColumn }, loadingResult: false });
      await get().loadHistory();
    } catch (e) {
      if (requestId !== dataRequestId || get().activeConnectionId !== id) return;
      set({ error: normalizeError(e), result: null, loadingResult: false });
    }
  },

  toggleRow: (i) =>
    set((s) => ({
      selection: s.selection.includes(i) ? s.selection.filter((x) => x !== i) : [...s.selection, i],
    })),

  clearSelection: () => set({ selection: [] }),

  setSelection: (indices) => set({ selection: [...new Set(indices)].filter((index) => index >= 0) }),

  deleteSelected: async () => {
    const { activeConnectionId, result, editTable, selection } = get();
    if (!activeConnectionId || !result || !editTable?.pkColumn || selection.length === 0) return;
    if (get().readOnlyConns.includes(activeConnectionId)) return toast("Read-only — writes are blocked.", "error");
    const pkIdx = result.columns.findIndex((c) => c.name === editTable.pkColumn);
    if (pkIdx < 0) return;
    const selectedRows = selection.filter((index) => index >= 0 && index < result.rows.length);
    if (selectedRows.length === 0) {
      set({ selection: [] });
      return;
    }
    const pks = selectedRows.map((index) => result.rows[index][pkIdx]);
    const pkColumn = editTable.pkColumn;
    const choice = await confirmDelete({
      title: `Delete ${pks.length} ${pks.length === 1 ? "row" : "rows"}?`,
      message: "This permanently deletes the selected rows. This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!choice.ok) return;
    const engine = get().connections.find((c) => c.id === activeConnectionId)?.engine;
    const conn = get().connections.find((connection) => connection.id === activeConnectionId);
    if (!(await confirmProdWrite(conn, "DELETE"))) return;
    try {
      if (choice.skipFk && !get().autoCommit) {
        if (get().txnDirty) {
          toast("Commit or roll back the open transaction before bypassing foreign-key checks.", "error");
          return;
        }
        toast("Force delete runs outside the manual transaction so foreign-key checks can be restored.", "info");
      } else {
        await get().beginTxnIfManual();
      }
      await withFkDisabled(activeConnectionId, engine, choice.skipFk, async () => {
        for (const pk of pks) {
          await backend.deleteRow(activeConnectionId, editTable.table, pkColumn, pk);
        }
      });
      if (
        get().activeConnectionId !== activeConnectionId ||
        get().editTable?.table !== editTable.table
      ) return;
      set({ selection: [] });
      await get().refresh();
    } catch (e) {
      set({ error: normalizeError(e) });
      toast(
        isFkError(e) ? "Delete blocked by a foreign key. Try again and tick “Skip foreign-key checks”." : normalizeError(e).message ?? "Delete failed",
        "error",
      );
    }
  },

  duplicateSelected: async () => {
    const { activeConnectionId, result, editTable, selection } = get();
    if (!activeConnectionId || !result || !editTable || selection.length === 0) return;
    if (get().readOnlyConns.includes(activeConnectionId)) return toast("Read-only — writes are blocked.", "error");
    const conn = get().connections.find((connection) => connection.id === activeConnectionId);
    if (!(await confirmProdWrite(conn, "INSERT"))) return;
    const selectedRows = selection.filter((index) => index >= 0 && index < result.rows.length);
    if (selectedRows.length === 0) {
      set({ selection: [] });
      return;
    }
    const pkIdx = editTable.pkColumn ? result.columns.findIndex((c) => c.name === editTable.pkColumn) : -1;
    // Compute the next integer id when the PK looks like an auto-increment integer.
    let nextId = 0;
    let intPk = false;
    if (pkIdx >= 0) {
      const nums = result.rows.map((r) => Number(r[pkIdx]));
      if (nums.length > 0 && nums.every((n) => Number.isInteger(n))) {
        intPk = true;
        nextId = Math.max(0, ...nums) + 1;
      }
    }
    try {
      await get().beginTxnIfManual();
      for (const i of selectedRows.sort((a, b) => a - b)) {
        const src = result.rows[i];
        const columns: string[] = [];
        const values: unknown[] = [];
        result.columns.forEach((c, j) => {
          columns.push(c.name);
          if (j === pkIdx) values.push(intPk ? nextId++ : `${String(src[j])}-copy`);
          else values.push(src[j]);
        });
        await backend.insertRow(activeConnectionId, editTable.table, columns, values);
      }
      if (
        get().activeConnectionId !== activeConnectionId ||
        get().editTable?.table !== editTable.table
      ) return;
      set({ selection: [] });
      await get().refresh();
    } catch (e) {
      set({ error: normalizeError(e) });
    }
  },

  loadSql: (sql) =>
    set((s) => {
      const editors = s.editors.map((e) => (e.id === s.activeEditorId ? { ...e, sql } : e));
      persistEditors(editors, s.activeEditorId);
      return { sql, editors, view: "sql", topView: "data" };
    }),

  saveScript: (name, sql) =>
    set((s) => {
      const item: SavedItem = { id: `s-${Date.now()}-${s.scripts.length}`, name, sql, savedAt: new Date().toISOString() };
      const scripts = [item, ...s.scripts];
      persistSaved(SCRIPTS_KEY, scripts);
      toast(`Saved script “${name}”`, "success");
      return { scripts };
    }),

  deleteScript: (id) =>
    set((s) => {
      const scripts = s.scripts.filter((x) => x.id !== id);
      persistSaved(SCRIPTS_KEY, scripts);
      return { scripts };
    }),

  saveFavorite: (name, sql) =>
    set((s) => {
      const item: SavedItem = { id: `f-${Date.now()}-${s.favorites.length}`, name, sql, savedAt: new Date().toISOString() };
      const favorites = [item, ...s.favorites];
      persistSaved(FAVS_KEY, favorites);
      toast(`Added “${name}” to favorites`, "success");
      return { favorites };
    }),

  deleteFavorite: (id) =>
    set((s) => {
      const favorites = s.favorites.filter((x) => x.id !== id);
      persistSaved(FAVS_KEY, favorites);
      return { favorites };
    }),
}));

function normalizeError(e: unknown): AppError {
  if (e && typeof e === "object" && "kind" in e) return e as AppError;
  return { kind: "internal", message: String(e) };
}
