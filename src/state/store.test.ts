import { beforeEach, describe, expect, it, vi } from "vitest";

const { fakeBackend, seededConnections } = vi.hoisted(() => {
  const seededConnections = [
    {
      id: "sqlite-a",
      name: "Local A",
      engine: "sqlite" as const,
      database: "a.sqlite",
    },
    {
      id: "sqlite-b",
      name: "Local B",
      engine: "sqlite" as const,
      database: "b.sqlite",
    },
  ];

  const tablesByConnection = {
    "sqlite-a": [{ name: "customers", kind: "table", schema: "main" }],
    "sqlite-b": [{ name: "orders", kind: "table", schema: "main" }],
  } as const;

  const columnsByTable = {
    customers: [
      { name: "id", dataType: "INTEGER", nullable: false, isPrimaryKey: true },
      { name: "name", dataType: "TEXT", nullable: false, isPrimaryKey: false },
    ],
    orders: [
      { name: "id", dataType: "INTEGER", nullable: false, isPrimaryKey: true },
      { name: "total", dataType: "REAL", nullable: false, isPrimaryKey: false },
    ],
  } as const;

  const customerResult = {
    columns: [
      { name: "id", dataType: "INTEGER" },
      { name: "name", dataType: "TEXT" },
    ],
    rows: [[1, "Ada"]],
    rowsAffected: 0,
    elapsedMs: 1,
    truncated: false,
  };

  const orderResult = {
    columns: [
      { name: "id", dataType: "INTEGER" },
      { name: "total", dataType: "REAL" },
    ],
    rows: [[10, 42.5]],
    rowsAffected: 0,
    elapsedMs: 1,
    truncated: false,
  };

  const fakeBackend = {
    listConnections: vi.fn(async () => seededConnections),
    openConnection: vi.fn(async () => {}),
    listTables: vi.fn(async (id: string) =>
      id === "sqlite-a" ? [...tablesByConnection["sqlite-a"]] : [...tablesByConnection["sqlite-b"]],
    ),
    listDatabaseObjects: vi.fn(async () => []),
    listColumns: vi.fn(async (_id: string, table: string) => [
      ...(columnsByTable[table as keyof typeof columnsByTable] ?? []),
    ]),
    runQuery: vi.fn(async (_id: string, sql: string) => {
      if (/\bnope\b/i.test(sql)) {
        throw { kind: "queryError", message: "no such table: nope" };
      }
      return /orders/i.test(sql) ? orderResult : customerResult;
    }),
    runQuerySilent: vi.fn(async (_id: string, sql: string) => {
      if (/count\s*\(/i.test(sql)) {
        return {
          columns: [{ name: "count", dataType: "INTEGER" }],
          rows: [[1]],
          rowsAffected: 0,
          elapsedMs: 1,
          truncated: false,
        };
      }
      return /orders/i.test(sql) ? orderResult : customerResult;
    }),
    recentHistory: vi.fn(async () => []),
  };

  return { fakeBackend, seededConnections };
});

vi.mock("../ipc/backend", () => ({
  getBackend: () => fakeBackend,
}));

import { useStore } from "./store";

describe("store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      connections: [],
      activeConnectionId: null,
      schema: { tables: [], objects: [], columnsByTable: {} },
      sql: "",
      editors: [{ id: "ed-test", name: "Query 1", sql: "", connectionId: null }],
      activeEditorId: "ed-test",
      editorResults: {},
      editorErrors: {},
      result: null,
      error: null,
      running: false,
      history: [],
      editTable: null,
      openTables: [],
      loadingTables: false,
      loadingResult: false,
      view: "sql",
      topView: "data",
      selection: [],
      readOnlyConns: [],
      dataPage: { page: 0, pageSize: 100, totalRows: 0, search: "" },
    });
  });

  it("loads backend connection profiles", async () => {
    await useStore.getState().loadConnections();
    expect(useStore.getState().connections).toEqual(seededConnections);
  });

  it("openAndIntrospect sets the active connection and schema", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("sqlite-a");

    expect(useStore.getState().activeConnectionId).toBe("sqlite-a");
    expect(useStore.getState().schema.tables.map((table) => table.name)).toEqual(["customers"]);
    expect(fakeBackend.openConnection).toHaveBeenCalledWith("sqlite-a");
  });

  it("run() populates the active editor result", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("sqlite-a");
    useStore.getState().setSql("SELECT * FROM customers");
    await useStore.getState().run();

    expect(useStore.getState().error).toBeNull();
    expect(useStore.getState().result?.rows).toEqual([[1, "Ada"]]);
  });

  it("run() stores a typed query error and clears the active result", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("sqlite-a");
    useStore.getState().setSql("SELECT * FROM nope");
    await useStore.getState().run();

    expect(useStore.getState().error?.kind).toBe("queryError");
    expect(useStore.getState().result).toBeNull();
  });

  it("run() without a connection never calls the backend", async () => {
    useStore.getState().setSql("SELECT 1");
    await useStore.getState().run();

    expect(fakeBackend.runQuery).not.toHaveBeenCalled();
    expect(useStore.getState().result).toBeNull();
  });

  it("new SQL tabs inherit the active connection", async () => {
    await useStore.getState().loadConnections();
    await useStore.getState().openAndIntrospect("sqlite-a");

    useStore.getState().newEditor();
    const state = useStore.getState();
    const editor = state.editors.find((item) => item.id === state.activeEditorId);
    expect(editor?.connectionId).toBe("sqlite-a");
  });

  it("switching SQL tabs restores their pinned connection", async () => {
    await useStore.getState().loadConnections();

    await useStore.getState().openAndIntrospect("sqlite-a");
    useStore.getState().newEditor();
    const firstTab = useStore.getState().activeEditorId;

    await useStore.getState().openAndIntrospect("sqlite-b");
    useStore.getState().newEditor();
    const secondTab = useStore.getState().activeEditorId;

    expect(useStore.getState().editors.find((item) => item.id === firstTab)?.connectionId).toBe("sqlite-a");
    expect(useStore.getState().editors.find((item) => item.id === secondTab)?.connectionId).toBe("sqlite-b");

    await useStore.getState().selectEditor(firstTab);
    expect(useStore.getState().activeConnectionId).toBe("sqlite-a");
  });

  it("switching sources clears the previous source's table and result state", async () => {
    await useStore.getState().loadConnections();

    await useStore.getState().openAndIntrospect("sqlite-a");
    await useStore.getState().openTableData("customers");
    expect(useStore.getState().editTable?.table).toBe("customers");
    expect(useStore.getState().result?.rows).toEqual([[1, "Ada"]]);

    await useStore.getState().openAndIntrospect("sqlite-b");
    expect(useStore.getState().editTable).toBeNull();
    expect(useStore.getState().result).toBeNull();
    expect(useStore.getState().schema.tables.map((table) => table.name)).toEqual(["orders"]);
  });
});
