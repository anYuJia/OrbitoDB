import { IconCode, IconKey, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { getBackend } from "../../ipc/backend";
import type { Engine, ForeignKey, QueryResult } from "../../ipc/types";
import { confirmDialog, promptDialog } from "../../state/dialog";
import { useStore } from "../../state/store";

type StructureMode = "columns" | "foreignKeys" | "indexes";
type IndexInfo = { name: string; unique: boolean; detail: string };

function literal(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdentifier(engine: Engine, value: string): string {
  return engine === "mysql"
    ? "`" + value.replace(/`/g, "``") + "`"
    : '"' + value.replace(/"/g, '""') + '"';
}

function columnIndex(result: QueryResult, ...names: string[]): number {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return result.columns.findIndex((column) => wanted.has(column.name.toLowerCase()));
}

async function loadIndexes(connectionId: string, engine: Engine, table: string): Promise<IndexInfo[]> {
  const backend = getBackend();

  if (engine === "sqlite") {
    const result = await backend.runQuery(connectionId, `PRAGMA index_list('${literal(table)}')`);
    const nameI = columnIndex(result, "name");
    const uniqueI = columnIndex(result, "unique");
    const originI = columnIndex(result, "origin");
    return result.rows.map((row) => ({
      name: String(row[nameI] ?? ""),
      unique: Number(row[uniqueI] ?? 0) === 1,
      detail: originI >= 0 ? `origin: ${String(row[originI] ?? "user")}` : "SQLite index",
    }));
  }

  if (engine === "postgres") {
    const result = await backend.runQuery(
      connectionId,
      `SELECT indexname AS name, indexdef AS definition
       FROM pg_indexes
       WHERE schemaname = current_schema()
         AND tablename = '${literal(table)}'
       ORDER BY indexname`,
    );
    const nameI = columnIndex(result, "name", "indexname");
    const defI = columnIndex(result, "definition", "indexdef");
    return result.rows.map((row) => {
      const definition = String(row[defI] ?? "");
      return {
        name: String(row[nameI] ?? ""),
        unique: /CREATE\s+UNIQUE\s+INDEX/i.test(definition),
        detail: definition,
      };
    });
  }

  const result = await backend.runQuery(connectionId, `SHOW INDEX FROM ${quoteIdentifier(engine, table)}`);
  const nameI = columnIndex(result, "Key_name", "key_name");
  const uniqueI = columnIndex(result, "Non_unique", "non_unique");
  const columnI = columnIndex(result, "Column_name", "column_name");
  const grouped = new Map<string, { unique: boolean; columns: string[] }>();
  for (const row of result.rows) {
    const name = String(row[nameI] ?? "");
    if (!name) continue;
    const item = grouped.get(name) ?? { unique: Number(row[uniqueI] ?? 1) === 0, columns: [] };
    const column = columnI >= 0 ? String(row[columnI] ?? "") : "";
    if (column) item.columns.push(column);
    grouped.set(name, item);
  }
  return [...grouped.entries()].map(([name, item]) => ({
    name,
    unique: item.unique,
    detail: item.columns.length ? item.columns.join(", ") : "MySQL index",
  }));
}

export function TableStructure({ table }: { table: string }) {
  const columns = useStore((s) => s.schema.columnsByTable[table] ?? []);
  const activeId = useStore((s) => s.activeConnectionId);
  const connection = useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId));
  const expandTable = useStore((s) => s.expandTable);
  const addColumn = useStore((s) => s.addColumn);
  const renameColumn = useStore((s) => s.renameColumn);
  const dropColumn = useStore((s) => s.dropColumn);
  const showTableDdl = useStore((s) => s.showTableDdl);
  const openSqlTab = useStore((s) => s.openSqlTab);
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));
  const [mode, setMode] = useState<StructureMode>("columns");
  const [foreignKeys, setForeignKeys] = useState<ForeignKey[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const engine = connection?.engine ?? "sqlite";

  useEffect(() => {
    setMode("columns");
  }, [table]);

  useEffect(() => {
    if (columns.length === 0) void expandTable(table);
  }, [columns.length, expandTable, table]);

  useEffect(() => {
    if (!activeId) {
      setForeignKeys([]);
      setIndexes([]);
      return;
    }

    let alive = true;
    setMetaLoading(true);
    setMetaError(null);

    Promise.all([
      getBackend().listForeignKeys(activeId),
      loadIndexes(activeId, engine, table),
    ])
      .then(([allFks, nextIndexes]) => {
        if (!alive) return;
        setForeignKeys(allFks.filter((fk) => fk.table === table));
        setIndexes(nextIndexes);
      })
      .catch((error) => {
        if (!alive) return;
        setMetaError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => alive && setMetaLoading(false));

    return () => {
      alive = false;
    };
  }, [activeId, engine, table]);

  const count = useMemo(
    () => (mode === "columns" ? columns.length : mode === "foreignKeys" ? foreignKeys.length : indexes.length),
    [columns.length, foreignKeys.length, indexes.length, mode],
  );

  const add = async () => {
    if (readOnly) return;
    const name = await promptDialog({
      title: "Add column",
      label: "Column name",
      placeholder: "e.g. created_at",
    });
    if (!name?.trim()) return;
    const dataType = await promptDialog({
      title: "Column type",
      label: "SQL type",
      defaultValue: "TEXT",
      placeholder: "TEXT, INTEGER, VARCHAR(255)…",
    });
    if (!dataType?.trim()) return;
    await addColumn(table, {
      name: name.trim(),
      dataType: dataType.trim().toUpperCase(),
      nullable: true,
      primaryKey: false,
    });
  };

  const rename = async (column: string) => {
    if (readOnly) return;
    const next = await promptDialog({
      title: "Rename column",
      label: "Column name",
      defaultValue: column,
    });
    if (!next?.trim() || next.trim() === column) return;
    await renameColumn(table, column, next.trim());
  };

  const remove = async (column: string, primaryKey: boolean) => {
    if (readOnly || primaryKey) return;
    if (
      await confirmDialog({
        title: "Drop column",
        message: `Drop "${column}" from "${table}"? All data in this column will be permanently deleted.`,
        confirmLabel: "Drop column",
        danger: true,
      })
    ) {
      await dropColumn(table, column);
    }
  };

  const createIndexTemplate = async () => {
    if (readOnly) return;
    const column = await promptDialog({
      title: "Create index",
      label: "Column",
      defaultValue: columns[0]?.name ?? "",
      placeholder: "column_name",
    });
    if (!column?.trim()) return;
    const defaultName = `idx_${table}_${column.trim()}`.replace(/[^a-zA-Z0-9_]+/g, "_");
    const name = await promptDialog({
      title: "Create index",
      label: "Index name",
      defaultValue: defaultName,
    });
    if (!name?.trim()) return;
    const q = (value: string) => quoteIdentifier(engine, value);
    openSqlTab(
      `Index · ${name.trim()}`,
      `CREATE INDEX ${q(name.trim())} ON ${q(table)} (${q(column.trim())});`,
    );
  };

  const createForeignKeyTemplate = async () => {
    if (readOnly || engine === "sqlite") return;
    const column = await promptDialog({
      title: "Add foreign key",
      label: "Local column",
      defaultValue: columns[0]?.name ?? "",
    });
    if (!column?.trim()) return;
    const refTable = await promptDialog({ title: "Add foreign key", label: "Referenced table" });
    if (!refTable?.trim()) return;
    const refColumn = await promptDialog({ title: "Add foreign key", label: "Referenced column", defaultValue: "id" });
    if (!refColumn?.trim()) return;
    const constraint = `fk_${table}_${column.trim()}`.replace(/[^a-zA-Z0-9_]+/g, "_");
    const q = (value: string) => quoteIdentifier(engine, value);
    const sql = [
      `ALTER TABLE ${q(table)}`,
      `  ADD CONSTRAINT ${q(constraint)}`,
      `  FOREIGN KEY (${q(column.trim())})`,
      `  REFERENCES ${q(refTable.trim())} (${q(refColumn.trim())});`,
    ].join("\n");
    openSqlTab(`FK · ${table}`, sql);
  };

  const primaryAction =
    mode === "columns"
      ? { label: "Add column", run: add, disabled: readOnly }
      : mode === "indexes"
        ? { label: "New index", run: createIndexTemplate, disabled: readOnly }
        : {
            label: engine === "sqlite" ? "DDL required" : "New foreign key",
            run: createForeignKeyTemplate,
            disabled: readOnly || engine === "sqlite",
          };

  return (
    <div className="odb-structure">
      <div className="odb-structure-head">
        <div>
          <span className="odb-structure-eyebrow">Table structure</span>
          <strong>{table}</strong>
          <span>{count} {mode === "columns" ? (count === 1 ? "column" : "columns") : mode === "foreignKeys" ? (count === 1 ? "foreign key" : "foreign keys") : (count === 1 ? "index" : "indexes")}</span>
        </div>
        <div className="odb-structure-actions">
          <button onClick={() => void showTableDdl(table)}>
            <IconCode size={14} stroke={1.8} />
            Open DDL
          </button>
          <button className="primary" onClick={() => void primaryAction.run()} disabled={primaryAction.disabled}>
            <IconPlus size={14} stroke={2} />
            {primaryAction.label}
          </button>
        </div>
      </div>

      <div className="odb-structure-tabs" role="tablist" aria-label="Table metadata">
        <button className={mode === "columns" ? "on" : ""} onClick={() => setMode("columns")}>Columns <span>{columns.length}</span></button>
        <button className={mode === "foreignKeys" ? "on" : ""} onClick={() => setMode("foreignKeys")}>Foreign Keys <span>{foreignKeys.length}</span></button>
        <button className={mode === "indexes" ? "on" : ""} onClick={() => setMode("indexes")}>Indexes <span>{indexes.length}</span></button>
      </div>

      {metaError && <div className="odb-structure-meta-error">{metaError}</div>}

      {mode === "columns" ? (
        <div className="odb-structure-table">
          <div className="odb-structure-row header">
            <span>#</span>
            <span>Name</span>
            <span>Type</span>
            <span>Nullable</span>
            <span>Key</span>
            <span />
          </div>
          {columns.length === 0 ? (
            <div className="odb-structure-empty">No column metadata available.</div>
          ) : (
            columns.map((column, index) => (
              <div className="odb-structure-row" key={column.name}>
                <span className="index">{index + 1}</span>
                <span className="name">
                  {column.isPrimaryKey && <IconKey size={12} stroke={2} />}
                  <code>{column.name}</code>
                </span>
                <span className="type"><code>{column.dataType || "TEXT"}</code></span>
                <span className={column.nullable ? "nullable yes" : "nullable no"}>
                  {column.nullable ? "YES" : "NO"}
                </span>
                <span className="key">{column.isPrimaryKey ? "PRIMARY" : "—"}</span>
                <span className="actions">
                  <button title="Rename column" onClick={() => void rename(column.name)} disabled={readOnly}>
                    <IconPencil size={13} stroke={1.8} />
                  </button>
                  <button
                    className="danger"
                    title={column.isPrimaryKey ? "Primary-key columns cannot be dropped here" : "Drop column"}
                    onClick={() => void remove(column.name, column.isPrimaryKey)}
                    disabled={readOnly || column.isPrimaryKey}
                  >
                    <IconTrash size={13} stroke={1.8} />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      ) : mode === "foreignKeys" ? (
        <div className="odb-structure-meta-table">
          <div className="odb-meta-row header">
            <span>Column</span><span>References</span><span>Relationship</span>
          </div>
          {metaLoading ? (
            <div className="odb-structure-empty">Loading foreign keys…</div>
          ) : foreignKeys.length === 0 ? (
            <div className="odb-structure-empty">No foreign keys defined on this table.</div>
          ) : (
            foreignKeys.map((fk, index) => (
              <div className="odb-meta-row" key={`${fk.column}-${fk.refTable}-${fk.refColumn}-${index}`}>
                <code>{fk.column}</code>
                <code>{fk.refTable}.{fk.refColumn}</code>
                <span>FOREIGN KEY</span>
              </div>
            ))
          )}
          {engine === "sqlite" && (
            <div className="odb-structure-note">SQLite cannot add a foreign-key constraint with ALTER TABLE. Open DDL to rebuild the table safely.</div>
          )}
        </div>
      ) : (
        <div className="odb-structure-meta-table">
          <div className="odb-meta-row header">
            <span>Name</span><span>Type</span><span>Definition / columns</span>
          </div>
          {metaLoading ? (
            <div className="odb-structure-empty">Loading indexes…</div>
          ) : indexes.length === 0 ? (
            <div className="odb-structure-empty">No indexes reported for this table.</div>
          ) : (
            indexes.map((index) => (
              <div className="odb-meta-row" key={index.name}>
                <code>{index.name}</code>
                <span>{index.unique ? "UNIQUE" : "INDEX"}</span>
                <code className="detail">{index.detail}</code>
              </div>
            ))
          )}
        </div>
      )}

      {readOnly && <div className="odb-structure-note">Read-only mode is enabled. Structure changes are disabled.</div>}
    </div>
  );
}
