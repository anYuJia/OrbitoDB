import { IconCode, IconKey, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect } from "react";
import { confirmDialog, promptDialog } from "../../state/dialog";
import { useStore } from "../../state/store";

export function TableStructure({ table }: { table: string }) {
  const columns = useStore((s) => s.schema.columnsByTable[table] ?? []);
  const expandTable = useStore((s) => s.expandTable);
  const addColumn = useStore((s) => s.addColumn);
  const renameColumn = useStore((s) => s.renameColumn);
  const dropColumn = useStore((s) => s.dropColumn);
  const showTableDdl = useStore((s) => s.showTableDdl);
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));

  useEffect(() => {
    if (columns.length === 0) void expandTable(table);
  }, [columns.length, expandTable, table]);

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

  return (
    <div className="odb-structure">
      <div className="odb-structure-head">
        <div>
          <span className="odb-structure-eyebrow">Table structure</span>
          <strong>{table}</strong>
          <span>{columns.length} {columns.length === 1 ? "column" : "columns"}</span>
        </div>
        <div className="odb-structure-actions">
          <button onClick={() => void showTableDdl(table)}>
            <IconCode size={14} stroke={1.8} />
            Open DDL
          </button>
          <button className="primary" onClick={() => void add()} disabled={readOnly}>
            <IconPlus size={14} stroke={2} />
            Add column
          </button>
        </div>
      </div>

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

      {readOnly && <div className="odb-structure-note">Read-only mode is enabled. Structure changes are disabled.</div>}
    </div>
  );
}
