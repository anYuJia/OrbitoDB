import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const connections = [
    { id: "alpha", name: "Alpha", engine: "sqlite", database: ":memory:", env: "dev" },
    { id: "beta", name: "Beta", engine: "sqlite", database: ":memory:", env: "prod" },
  ];
  const tables = {
    alpha: [{ name: "customers", kind: "table", schema: null }],
    beta: [{ name: "invoices", kind: "table", schema: null }],
  };
  const columns = {
    customers: [
      { name: "id", dataType: "INTEGER", nullable: false, isPrimaryKey: true },
      { name: "name", dataType: "TEXT", nullable: false, isPrimaryKey: false },
    ],
    invoices: [{ name: "id", dataType: "INTEGER", nullable: false, isPrimaryKey: true }],
  };

  const runQuery = vi.fn(async (_connectionId: string, sql: string) => {
    if (/\bnope\b/i.test(sql)) throw { kind: "queryError", message: "no such table: nope" };
    if (/\bcustomers\b/i.test(sql)) {
      return {
        columns: columns.customers.map(({ name, dataType }) => ({ name, dataType })),
        rows: [
          [1, "Ada"],
          [2, "Linus"],
        ],
        rowsAffected: 0,
        elapsedMs: 1,
        truncated: false,
      };
    }
    if (/\binvoices\b/i.test(sql)) {
      return {
        columns: [{ name: "id", dataType: "INTEGER" }],
        rows: [[10]],
        rowsAffected: 0,
        elapsedMs: 1,
        truncated: false,
      };
    }
    return { columns: [], rows: [], rowsAffected: 0, elapsedMs: 1, truncated: false };
  });

  return {
    backend: {
      listConnections: vi.fn(async () => connections.map((connection) => ({ ...connection }))),
      deleteConnection: vi.fn(async () => {}),
      openConnection: vi.fn(async () => {}),
      listTables: vi.fn(async (id: "alpha" | "beta") => tables[id].map((table) => ({ ...table }))),
      listColumns: vi.fn(async (_id: string, table: "customers" | "invoices") =>
        columns[table].map((column) => ({ ...column })),
      ),
      runQuery,
      insertRow: vi.fn(async () => {}),
      recentHistory: vi.fn(async () => []),
    },
  };
});

vi.mock("../ipc/backend", () => ({ getBackend: () => mock.backend }));

import { useStore } from "./store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      connections: [],
      activeConnectionId: null,
      connectingConnectionId: null,
      schema: { tables: [], columnsByTable: {} },
      sql: "",
      editors: [{ id: "ed-test", name: "Query 1", sql: "" }],
      activeEditorId: "ed-test",
      editorResults: {},
      editorErrors: {},
      result: null,
      error: null,
      running: false,
      history: [],
      view: "sql",
      editTable: null,
      openTables: [],
      selection: [],
      inspectorRow: null,
      views: [],
      activeViewId: null,
      readOnlyConns: [],
      autoCommit: true,
      txnDirty: false,
      txnConnectionId: null,
    });
  });

  it("loads saved connections including their safety environment", async () => {
    await useStore.getState().loadConnections();
    expect(useStore.getState().connections).toHaveLength(2);
    expect(useStore.getState().connections[1].env).toBe("prod");
  });

  it("keeps saved views when read-only mode changes", () => {
    useStore.setState({
      views: [
        {
          id: "view-alpha-customers",
          connectionId: "alpha",
          table: "customers",
          name: "Active customers",
          filter: null,
        },
      ],
    });

    useStore.getState().toggleReadOnly("alpha");

    expect(useStore.getState().views).toHaveLength(1);
  });

  it("reuses an untouched query tab instead of creating tab clutter", () => {
    useStore.setState({
      editors: [
        { id: "ed-sql", name: "Query 1", sql: "SELECT 1" },
        { id: "ed-blank", name: "Query 2", sql: "" },
      ],
      activeEditorId: "ed-sql",
      sql: "SELECT 1",
      editorResults: {},
      editorErrors: {},
      view: "overview",
    });

    useStore.getState().newEditor();

    expect(useStore.getState().editors).toHaveLength(2);
    expect(useStore.getState().activeEditorId).toBe("ed-blank");
    expect(useStore.getState().view).toBe("sql");
  });

  it("closes several query tabs as one workspace action", () => {
    useStore.setState({
      editors: [
        { id: "ed-1", name: "Query 1", sql: "SELECT 1" },
        { id: "ed-2", name: "Query 2", sql: "SELECT 2" },
        { id: "ed-3", name: "Query 3", sql: "SELECT 3" },
      ],
      activeEditorId: "ed-2",
      sql: "SELECT 2",
      editorResults: { "ed-1": null, "ed-2": null, "ed-3": null },
      editorErrors: { "ed-1": null, "ed-2": null, "ed-3": null },
    });

    useStore.getState().closeEditors(["ed-1", "ed-2"]);

    expect(useStore.getState().editors.map((editor) => editor.id)).toEqual(["ed-3"]);
    expect(useStore.getState().activeEditorId).toBe("ed-3");
    expect(useStore.getState().sql).toBe("SELECT 3");
  });

  it("removes saved views when an inactive connection is deleted", async () => {
    useStore.setState({
      activeConnectionId: "alpha",
      views: [
        { id: "view-alpha", connectionId: "alpha", table: "customers", name: "Customers", filter: null },
        { id: "view-beta", connectionId: "beta", table: "invoices", name: "Invoices", filter: null },
      ],
      activeViewId: "view-beta",
    });

    await useStore.getState().deleteConnection("beta");

    expect(useStore.getState().views.map((view) => view.id)).toEqual(["view-alpha"]);
    expect(useStore.getState().activeViewId).toBeNull();
  });

  it("opens a connection and introspects its tables", async () => {
    await useStore.getState().loadConnections();
    expect(await useStore.getState().openAndIntrospect("alpha")).toBe(true);
    expect(useStore.getState().activeConnectionId).toBe("alpha");
    expect(useStore.getState().view).toBe("overview");
    expect(useStore.getState().schema.tables.map((table) => table.name)).toEqual(["customers"]);
  });

  it("stores successful query results per editor", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    useStore.getState().setSql("SELECT * FROM customers");
    await useStore.getState().run();
    expect(useStore.getState().editorErrors["ed-test"]).toBeNull();
    expect(useStore.getState().editorResults["ed-test"]?.rows).toHaveLength(2);
  });

  it("refreshes the schema tree after DDL", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    const introspections = mock.backend.listTables.mock.calls.length;
    useStore.getState().setSql("CREATE TABLE notes (id INTEGER PRIMARY KEY)");
    await useStore.getState().run();
    expect(mock.backend.listTables).toHaveBeenCalledTimes(introspections + 1);
  });

  it("stores typed query errors per editor", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    useStore.getState().setSql("SELECT * FROM nope");
    await useStore.getState().run();
    expect(useStore.getState().editorErrors["ed-test"]?.kind).toBe("queryError");
    expect(useStore.getState().editorResults["ed-test"]).toBeNull();
  });

  it("reports a typed error when a query has no connection", async () => {
    useStore.getState().setSql("SELECT 1");
    await useStore.getState().run();
    expect(useStore.getState().error?.kind).toBe("notConnected");
    expect(useStore.getState().editorErrors["ed-test"]?.kind).toBe("notConnected");
  });

  it("clears source-specific state when switching connections", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    await useStore.getState().openTableData("customers");
    expect(useStore.getState().editTable?.table).toBe("customers");

    await useStore.getState().openAndIntrospect("beta");
    expect(useStore.getState().editTable).toBeNull();
    expect(useStore.getState().result).toBeNull();
    expect(useStore.getState().schema.tables.map((table) => table.name)).toEqual(["invoices"]);
  });

  it("disconnects cleanly when opening a connection fails", async () => {
    await useStore.getState().loadConnections();
    mock.backend.openConnection.mockRejectedValueOnce({ kind: "notConnected", message: "offline" });

    const opened = await useStore.getState().openAndIntrospect("alpha");

    expect(opened).toBe(false);
    expect(useStore.getState().activeConnectionId).toBeNull();
    expect(useStore.getState().connectingConnectionId).toBeNull();
    expect(useStore.getState().loadingTables).toBe(false);
    expect(useStore.getState().error?.kind).toBe("notConnected");
  });

  it("restores the previous workspace when a connection switch fails", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    await useStore.getState().openTableData("customers");
    mock.backend.openConnection.mockRejectedValueOnce({ kind: "notConnected", message: "beta offline" });

    const opened = await useStore.getState().openAndIntrospect("beta");

    expect(opened).toBe(false);
    expect(useStore.getState().activeConnectionId).toBe("alpha");
    expect(useStore.getState().editTable?.table).toBe("customers");
    expect(useStore.getState().result?.rows).toHaveLength(2);
    expect(useStore.getState().schema.tables.map((table) => table.name)).toEqual(["customers"]);
    expect(useStore.getState().error?.message).toBe("beta offline");
  });

  it("ignores a stale connection response after the user switches again", async () => {
    await useStore.getState().loadConnections();
    const firstTables = deferred<Array<{ name: string; kind: string; schema: null }>>();
    mock.backend.listTables.mockImplementationOnce(() => firstTables.promise);

    const first = useStore.getState().openAndIntrospect("alpha");
    await vi.waitFor(() => expect(mock.backend.listTables).toHaveBeenCalledTimes(1));
    await useStore.getState().openAndIntrospect("beta");
    firstTables.resolve([{ name: "customers", kind: "table", schema: null }]);
    await first;

    expect(useStore.getState().activeConnectionId).toBe("beta");
    expect(useStore.getState().schema.tables.map((table) => table.name)).toEqual(["invoices"]);
  });

  it("quotes table names and keeps internal browsing out of query history", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    await useStore.getState().openTableData("order details");

    expect(mock.backend.runQuery).toHaveBeenLastCalledWith(
      "alpha",
      'SELECT * FROM "order details" LIMIT 1001;',
      { recordHistory: false },
    );
  });

  it("runs saved-view filters in the database and scopes table search to the view", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    const view = {
      id: "view-alpha-linus",
      connectionId: "alpha",
      table: "customers",
      name: "Linus only",
      filter: { column: "name", op: "=" as const, value: "Linus" },
    };
    useStore.setState({ views: [view] });
    mock.backend.runQuery.mockResolvedValueOnce({
      columns: [
        { name: "id", dataType: "INTEGER" },
        { name: "name", dataType: "TEXT" },
      ],
      rows: [[2, "Linus"]],
      rowsAffected: 0,
      elapsedMs: 1,
      truncated: false,
    });

    await useStore.getState().openView(view);

    expect(mock.backend.runQuery).toHaveBeenLastCalledWith(
      "alpha",
      'SELECT * FROM "customers" WHERE "name" = \'Linus\' LIMIT 1001;',
      { recordHistory: false },
    );
    expect(useStore.getState().openTables).toContain("customers");
    expect(useStore.getState().result?.rows).toEqual([[2, "Linus"]]);

    await useStore.getState().searchTable("Linus");
    const calls = mock.backend.runQuery.mock.calls;
    const searchSql = String(calls[calls.length - 1]?.[1]);
    expect(searchSql).toContain('WHERE ("name" = \'Linus\') AND (');
    expect(searchSql).toContain('LOWER(CAST("name" AS TEXT)) LIKE \'%linus%\' ESCAPE \'!\'');
    expect(searchSql).toContain("LIMIT 1001;");
  });

  it("reloads the full table when the active saved view is removed", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    const view = {
      id: "view-alpha-ada",
      connectionId: "alpha",
      table: "customers",
      name: "Ada only",
      filter: { column: "name", op: "=" as const, value: "Ada" },
    };
    useStore.setState({ views: [view] });
    await useStore.getState().openView(view);
    mock.backend.runQuery.mockClear();

    useStore.getState().deleteView(view.id);

    await vi.waitFor(() => expect(mock.backend.runQuery).toHaveBeenCalled());
    expect(mock.backend.runQuery).toHaveBeenLastCalledWith(
      "alpha",
      'SELECT * FROM "customers" LIMIT 1001;',
      { recordHistory: false },
    );
    expect(useStore.getState().activeViewId).toBeNull();
    expect(useStore.getState().views).toEqual([]);
  });

  it("persists saved-view definitions when they change", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    try {
      const views = [{
        id: "view-persisted",
        connectionId: "alpha",
        table: "customers",
        name: "Persisted",
        filter: { column: "name", op: "contains" as const, value: "a" },
      }];

      useStore.setState({ views });

      expect(setItem).toHaveBeenCalledWith("orbitodb.views", JSON.stringify(views));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("duplicates rows without copying the primary key", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    await useStore.getState().openTableData("customers");
    useStore.setState({ selection: [0] });

    await useStore.getState().duplicateSelected();

    expect(mock.backend.insertRow).toHaveBeenCalledWith(
      "alpha",
      "customers",
      ["name"],
      ["Ada"],
    );
  });

  it("deduplicates concurrent query runs", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    useStore.getState().setSql("SELECT * FROM customers");
    const pending = deferred<{
      columns: Array<{ name: string; dataType: string }>;
      rows: (string | number)[][];
      rowsAffected: number;
      elapsedMs: number;
      truncated: boolean;
    }>();
    mock.backend.runQuery.mockImplementationOnce(() => pending.promise);

    const first = useStore.getState().run();
    await vi.waitFor(() => expect(mock.backend.runQuery).toHaveBeenCalledTimes(1));
    await useStore.getState().run();
    pending.resolve({ columns: [{ name: "id", dataType: "INTEGER" }], rows: [[1]], rowsAffected: 0, elapsedMs: 1, truncated: false });
    await first;

    expect(mock.backend.runQuery).toHaveBeenCalledTimes(1);
    expect(useStore.getState().editorResults["ed-test"]?.rows).toEqual([[1]]);
    expect(useStore.getState().running).toBe(false);
  });

  it("ignores a query result after Stop", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    useStore.getState().setSql("SELECT * FROM customers");
    const pending = deferred<{
      columns: Array<{ name: string; dataType: string }>;
      rows: (string | number)[][];
      rowsAffected: number;
      elapsedMs: number;
      truncated: boolean;
    }>();
    mock.backend.runQuery.mockImplementationOnce(() => pending.promise);

    const running = useStore.getState().run();
    await vi.waitFor(() => expect(mock.backend.runQuery).toHaveBeenCalledTimes(1));
    useStore.getState().cancelRun();
    pending.resolve({ columns: [{ name: "id", dataType: "INTEGER" }], rows: [[99]], rowsAffected: 0, elapsedMs: 1, truncated: false });
    await running;

    expect(useStore.getState().editorResults["ed-test"]).toBeNull();
    expect(useStore.getState().running).toBe(false);
  });

  it("pins a manual transaction to its connection and blocks unsafe switching", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("alpha");
    useStore.getState().setAutoCommit(false);
    useStore.getState().setSql("UPDATE customers SET name = 'Grace' WHERE id = 1");
    await useStore.getState().run();

    expect(mock.backend.runQuery.mock.calls.slice(-2)).toEqual([
      ["alpha", "BEGIN", { recordHistory: false }],
      ["alpha", "UPDATE customers SET name = 'Grace' WHERE id = 1"],
    ]);
    expect(useStore.getState().txnConnectionId).toBe("alpha");

    const openCalls = mock.backend.openConnection.mock.calls.length;
    await useStore.getState().openAndIntrospect("alpha");
    await useStore.getState().openAndIntrospect("beta");
    expect(useStore.getState().activeConnectionId).toBe("alpha");
    expect(mock.backend.openConnection).toHaveBeenCalledTimes(openCalls);

    await useStore.getState().rollbackTxn();
    expect(mock.backend.runQuery).toHaveBeenLastCalledWith("alpha", "ROLLBACK", { recordHistory: false });
    expect(useStore.getState().txnDirty).toBe(false);
  });
});
