import { IconCode, IconKey, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { getBackend } from "../../ipc/backend";
import type { ColumnInfo, ConstraintInfo, Engine, ForeignKey, IndexInfo } from "../../ipc/types";
import { confirmDialog, promptDialog } from "../../state/dialog";
import { buildColumnAlterPlan, buildConstraintAddSql, buildConstraintDropSql, buildSqliteRebuildSql } from "../../lib/schemaChanges";
import { confirmProdWrite } from "../../state/safety";
import { toast } from "../../state/toast";
import { useStore } from "../../state/store";

type StructureMode = "columns" | "foreignKeys" | "indexes" | "constraints";
function quoteIdentifier(engine: Engine, value: string): string {
  return engine === "mysql"
    ? "`" + value.replace(/`/g, "``") + "`"
    : '"' + value.replace(/"/g, '""') + '"';
}

export function TableStructure({ table }: { table: string }) {
  const columns = useStore((s) => s.schema.columnsByTable[table] ?? []);
  const tables = useStore((s) => s.schema.tables);
  const activeId = useStore((s) => s.activeConnectionId);
  const connection = useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId));
  const expandTable = useStore((s) => s.expandTable);
  const refreshColumns = useStore((s) => s.refreshColumns);
  const openSqlTab = useStore((s) => s.openSqlTab);
  const addColumn = useStore((s) => s.addColumn);
  const dropColumn = useStore((s) => s.dropColumn);
  const showTableDdl = useStore((s) => s.showTableDdl);
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));
  const [mode, setMode] = useState<StructureMode>("columns");
  const [foreignKeys, setForeignKeys] = useState<ForeignKey[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const engine = connection?.engine ?? "sqlite";

  useEffect(() => {
    setMode("columns");
  }, [table]);

  useEffect(() => {
    if (columns.length === 0) void expandTable(table);
  }, [columns.length, expandTable, table]);

  const refreshMetadata = async () => {
    if (!activeId) {
      setForeignKeys([]);
      setIndexes([]);
      setConstraints([]);
      return;
    }
    setMetaLoading(true);
    setMetaError(null);
    try {
      const [allFks, nextIndexes, nextConstraints] = await Promise.all([
        getBackend().listForeignKeys(activeId),
        getBackend().listIndexes(activeId, table),
        getBackend().listConstraints(activeId, table),
      ]);
      setForeignKeys(allFks.filter((fk) => fk.table === table));
      setIndexes(nextIndexes);
      setConstraints(nextConstraints);
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : String(error));
    } finally {
      setMetaLoading(false);
    }
  };

  useEffect(() => {
    void refreshMetadata();
  }, [activeId, engine, table]);

  const executeStructureSql = async (
    sql: string | string[],
    successMessage: string,
    destructiveMessage?: string,
  ) => {
    if (!activeId || readOnly) return false;
    const statements = Array.isArray(sql) ? sql : [sql];
    const preview = statements.join("\n");
    if (
      destructiveMessage &&
      !(await confirmDialog({
        title: "Apply schema change?",
        message: destructiveMessage,
        confirmLabel: "Apply change",
        danger: true,
      }))
    ) {
      return false;
    }
    if (!(await confirmProdWrite(connection, preview))) return false;

    setMetaLoading(true);
    setMetaError(null);
    try {
      for (const statement of statements) {
        if (statement.trim()) await getBackend().runQuerySilent(activeId, statement);
      }
      await Promise.all([refreshColumns(table), refreshMetadata()]);
      toast(successMessage, "success");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMetaError(message);
      toast(message || "Schema change failed", "error");
      return false;
    } finally {
      setMetaLoading(false);
    }
  };

  const count = useMemo(
    () =>
      mode === "columns"
        ? columns.length
        : mode === "foreignKeys"
          ? foreignKeys.length
          : mode === "constraints"
            ? constraints.length
            : indexes.length,
    [columns.length, constraints.length, foreignKeys.length, indexes.length, mode],
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

  const editColumn = async (column: ColumnInfo) => {
    if (readOnly) return;

    const name = await promptDialog({
      title: "Column properties",
      label: "Name",
      defaultValue: column.name,
    });
    if (!name?.trim()) return;

    const dataType = await promptDialog({
      title: "Column properties",
      label: "SQL type",
      defaultValue: column.dataType || "TEXT",
      placeholder: "VARCHAR(255), BIGINT, TIMESTAMP…",
    });
    if (!dataType?.trim()) return;

    const nullableValue = await promptDialog({
      title: "Column properties",
      label: "Nullable",
      defaultValue: column.nullable ? "yes" : "no",
      placeholder: "yes or no",
    });
    if (!nullableValue?.trim()) return;
    const nullableNormalized = nullableValue.trim().toLowerCase();
    if (!["yes", "no", "true", "false"].includes(nullableNormalized)) {
      toast('Nullable must be "yes" or "no".', "error");
      return;
    }

    let defaultValue = column.defaultValue ?? "";
    if (!column.generated && !/IDENTITY/i.test(column.extra ?? "")) {
      const nextDefault = await promptDialog({
        title: "Column properties",
        label: "Default SQL expression (blank = none)",
        defaultValue,
        placeholder: "CURRENT_TIMESTAMP, 0, 'guest'…",
      });
      if (nextDefault == null) return;
      defaultValue = nextDefault;
    }

    let comment = column.comment ?? "";
    if (engine !== "sqlite") {
      const nextComment = await promptDialog({
        title: "Column properties",
        label: "Comment (blank = none)",
        defaultValue: comment,
      });
      if (nextComment == null) return;
      comment = nextComment;
    }

    const next = {
      name: name.trim(),
      dataType: dataType.trim(),
      nullable: nullableNormalized === "yes" || nullableNormalized === "true",
      defaultValue: defaultValue.trim() ? defaultValue.trim() : null,
      comment: comment.trim() ? comment.trim() : null,
    };

    try {
      const plan = buildColumnAlterPlan(engine, table, column, next);
      if (plan.requiresReview) {
        const script = buildSqliteRebuildSql(
          table,
          columns,
          column.name,
          next,
          foreignKeys,
          indexes,
          constraints,
        );
        openSqlTab(`Rebuild · ${table}.${column.name}`, script);
        toast("SQLite rebuild SQL opened for review. It was not executed automatically.", "info");
        return;
      }
      if (!plan.statements.length) {
        toast("No column changes to apply.", "info");
        return;
      }
      const structural =
        next.name !== column.name ||
        next.dataType.toLowerCase() !== (column.dataType || "TEXT").toLowerCase() ||
        next.nullable !== column.nullable;
      await executeStructureSql(
        plan.statements,
        `Updated column ${column.name}`,
        structural
          ? `Apply column changes to “${table}.${column.name}”? Type/nullability changes can fail or affect existing data.`
          : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMetaError(message);
      toast(message, "error");
    }
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
    const rawColumns = await promptDialog({
      title: "Create index",
      label: "Columns",
      defaultValue: columns[0]?.name ?? "",
      placeholder: "email, created_at",
    });
    if (!rawColumns?.trim()) return;

    const requested = rawColumns
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (requested.length === 0) return;

    const known = new Set(columns.map((column) => column.name));
    const invalid = requested.filter((column) => !known.has(column));
    if (invalid.length) {
      await confirmDialog({
        title: "Unknown index columns",
        message: `These columns are not present in the loaded table metadata: ${invalid.join(", ")}`,
        confirmLabel: "Close",
      });
      return;
    }

    const defaultName = `idx_${table}_${requested.join("_")}`.replace(/[^a-zA-Z0-9_]+/g, "_");
    const name = await promptDialog({
      title: "Create index",
      label: "Index name",
      defaultValue: defaultName,
    });
    if (!name?.trim()) return;

    const type = await promptDialog({
      title: "Index type",
      label: "Type",
      defaultValue: "normal",
      placeholder: "normal or unique",
    });
    if (!type?.trim()) return;
    const normalizedType = type.trim().toLowerCase();
    if (normalizedType !== "normal" && normalizedType !== "unique") {
      await confirmDialog({
        title: "Invalid index type",
        message: 'Use "normal" or "unique".',
        confirmLabel: "Close",
      });
      return;
    }
    const unique = normalizedType === "unique";

    const q = (value: string) => quoteIdentifier(engine, value);
    const sql = `CREATE ${unique ? "UNIQUE " : ""}INDEX ${q(name.trim())} ON ${q(table)} (${requested.map(q).join(", ")});`;
    await executeStructureSql(
      sql,
      `Created index ${name.trim()}`,
    );
  };

  const dropIndex = async (indexName: string) => {
    if (readOnly) return;
    const q = (value: string) => quoteIdentifier(engine, value);
    const sql =
      engine === "mysql"
        ? `DROP INDEX ${q(indexName)} ON ${q(table)};`
        : `DROP INDEX ${q(indexName)};`;
    await executeStructureSql(
      sql,
      `Dropped index ${indexName}`,
      `Drop index “${indexName}” from “${table}”? Query performance may change immediately.`,
    );
  };

  const constraintOwnedIndexes = useMemo(
    () =>
      new Set(
        constraints
          .filter((constraint) => constraint.kind === "primary" || constraint.kind === "unique")
          .map((constraint) => constraint.name)
          .filter((name): name is string => !!name),
      ),
    [constraints],
  );

  const isManagedIndex = (name: string) =>
    name === "PRIMARY" ||
    name.startsWith("sqlite_autoindex_") ||
    constraintOwnedIndexes.has(name) ||
    (engine === "postgres" && name.endsWith("_pkey"));

  const createForeignKeyTemplate = async () => {
    if (readOnly || engine === "sqlite" || !activeId) return;
    const column = await promptDialog({
      title: "Add foreign key",
      label: "Local column",
      defaultValue: columns[0]?.name ?? "",
    });
    const localColumn = column?.trim();
    if (!localColumn) return;
    if (!columns.some((item) => item.name === localColumn)) {
      await confirmDialog({
        title: "Unknown local column",
        message: `“${localColumn}” is not present in the loaded metadata for “${table}”.`,
        confirmLabel: "Close",
      });
      return;
    }

    const refTable = await promptDialog({
      title: "Add foreign key",
      label: "Referenced table",
      placeholder: tables.find((item) => item.kind === "table" && item.name !== table)?.name ?? "table_name",
    });
    const targetTable = refTable?.trim();
    if (!targetTable) return;
    if (!tables.some((item) => item.kind === "table" && item.name === targetTable)) {
      await confirmDialog({
        title: "Unknown referenced table",
        message: `“${targetTable}” is not present in the active schema.`,
        confirmLabel: "Close",
      });
      return;
    }

    let targetColumns;
    try {
      targetColumns = await getBackend().listColumns(activeId, targetTable);
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : String(error));
      return;
    }
    const defaultRef = targetColumns.find((item) => item.isPrimaryKey)?.name ?? targetColumns[0]?.name ?? "id";
    const refColumn = await promptDialog({
      title: "Add foreign key",
      label: "Referenced column",
      defaultValue: defaultRef,
    });
    const targetColumn = refColumn?.trim();
    if (!targetColumn) return;
    if (!targetColumns.some((item) => item.name === targetColumn)) {
      await confirmDialog({
        title: "Unknown referenced column",
        message: `“${targetColumn}” is not present on “${targetTable}”.`,
        confirmLabel: "Close",
      });
      return;
    }

    const constraint = `fk_${table}_${localColumn}`.replace(/[^a-zA-Z0-9_]+/g, "_");
    const q = (value: string) => quoteIdentifier(engine, value);
    const sql = [
      `ALTER TABLE ${q(table)}`,
      `  ADD CONSTRAINT ${q(constraint)}`,
      `  FOREIGN KEY (${q(localColumn)})`,
      `  REFERENCES ${q(targetTable)} (${q(targetColumn)});`,
    ].join("\n");
    await executeStructureSql(sql, `Created foreign key ${constraint}`);
  };

  const dropForeignKey = async (constraintName: string | null | undefined) => {
    if (readOnly || engine === "sqlite" || !constraintName) return;
    const q = (value: string) => quoteIdentifier(engine, value);
    const sql =
      engine === "mysql"
        ? `ALTER TABLE ${q(table)} DROP FOREIGN KEY ${q(constraintName)};`
        : `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(constraintName)};`;
    await executeStructureSql(
      sql,
      `Dropped foreign key ${constraintName}`,
      `Drop foreign key “${constraintName}” from “${table}”? Referential-integrity enforcement will change immediately.`,
    );
  };

  const primaryAction =
    mode === "columns"
      ? { label: "Add column", run: add, disabled: readOnly || metaLoading }
      : mode === "indexes"
        ? { label: "New index", run: createIndexTemplate, disabled: readOnly || metaLoading }
        : {
            label: engine === "sqlite" ? "DDL required" : "New foreign key",
            run: createForeignKeyTemplate,
            disabled: readOnly || metaLoading || engine === "sqlite",
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
            <span>Default</span>
            <span>Nullable</span>
            <span>Key</span>
            <span>Comment</span>
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
                <span className="type">
                  <code title={column.dataType || "TEXT"}>{column.dataType || "TEXT"}</code>
                  {column.generated && (
                    <small title={column.generated}>
                      {column.generated.includes("expression unavailable") ? column.generated.split(" ")[0] + " generated" : "generated"}
                    </small>
                  )}
                </span>
                <span className="default" title={column.defaultValue ?? undefined}>
                  <code>{column.defaultValue ?? "—"}</code>
                </span>
                <span className={column.nullable ? "nullable yes" : "nullable no"}>
                  {column.nullable ? "YES" : "NO"}
                </span>
                <span className="key">{column.isPrimaryKey ? "PRIMARY" : "—"}</span>
                <span className="comment" title={column.comment ?? undefined}>
                  {column.comment || "—"}
                </span>
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
        <div className="odb-structure-meta-table foreign-keys">
          <div className="odb-meta-row header">
            <span>Column</span><span>References</span><span>Constraint</span><span />
          </div>
          {metaLoading ? (
            <div className="odb-structure-empty">Loading foreign keys…</div>
          ) : foreignKeys.length === 0 ? (
            <div className="odb-structure-empty">No foreign keys defined on this table.</div>
          ) : (
            foreignKeys.map((fk, index) => (
              <div className="odb-meta-row" key={`${fk.name ?? "fk"}-${fk.column}-${fk.refTable}-${fk.refColumn}-${index}`}>
                <code>{fk.column}</code>
                <code>{fk.refTable}.{fk.refColumn}</code>
                <code className="detail">{fk.name ?? (engine === "sqlite" ? "inline / unnamed" : "unnamed")}</code>
                <span className="actions">
                  <button
                    className="danger"
                    title={
                      engine === "sqlite"
                        ? "SQLite foreign keys require a table rebuild"
                        : fk.name
                          ? "Generate DROP foreign-key SQL"
                          : "Constraint name unavailable"
                    }
                    disabled={readOnly || metaLoading || engine === "sqlite" || !fk.name}
                    onClick={() => void dropForeignKey(fk.name)}
                  >
                    <IconTrash size={13} stroke={1.8} />
                  </button>
                </span>
              </div>
            ))
          )}
          {engine === "sqlite" && (
            <div className="odb-structure-note">SQLite foreign-key changes require rebuilding the table. Open DDL and review the full definition first.</div>
          )}
        </div>
      ) : (
        <div className="odb-structure-meta-table indexes">
          <div className="odb-meta-row header">
            <span>Name</span><span>Type</span><span>Definition / columns</span><span />
          </div>
          {metaLoading ? (
            <div className="odb-structure-empty">Loading indexes…</div>
          ) : indexes.length === 0 ? (
            <div className="odb-structure-empty">No indexes reported for this table.</div>
          ) : (
            indexes.map((index) => {
              const managed = isManagedIndex(index.name);
              return (
                <div className="odb-meta-row" key={index.name}>
                  <code>{index.name}</code>
                  <span>{managed ? "PRIMARY / SYSTEM" : index.unique ? "UNIQUE" : "INDEX"}</span>
                  <code className="detail">{index.detail}</code>
                  <span className="actions">
                    <button
                      className="danger"
                      title={managed ? "Managed primary/system indexes are changed through their constraint" : "Drop index"}
                      onClick={() => void dropIndex(index.name)}
                      disabled={readOnly || metaLoading || managed}
                    >
                      <IconTrash size={13} stroke={1.8} />
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {readOnly && <div className="odb-structure-note">Read-only mode is enabled. Structure changes are disabled.</div>}
    </div>
  );
}
