import { IconCode, IconKey, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { ColumnInfo } from "../../ipc/types";
import { confirmDialog } from "../../state/dialog";
import { useStore } from "../../state/store";

export interface ColumnEditorAnchor {
  column: ColumnInfo;
  x: number;
  y: number;
}

export function ColumnEditor({
  anchor,
  table,
  onClose,
}: {
  anchor: ColumnEditorAnchor;
  table: string;
  onClose: () => void;
}) {
  const { column } = anchor;
  const renameColumn = useStore((s) => s.renameColumn);
  const dropColumn = useStore((s) => s.dropColumn);
  const showTableDdl = useStore((s) => s.showTableDdl);
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));
  const [name, setName] = useState(column.name);
  const [busy, setBusy] = useState(false);

  const left = Math.max(12, Math.min(anchor.x, window.innerWidth - 350));
  const top = Math.max(56, Math.min(anchor.y + 4, window.innerHeight - 360));
  const dirty = name.trim() !== column.name && !!name.trim();

  const save = async () => {
    const next = name.trim();
    if (!next || next === column.name || readOnly) {
      onClose();
      return;
    }
    setBusy(true);
    await renameColumn(table, column.name, next);
    onClose();
  };

  const del = async () => {
    if (readOnly || column.isPrimaryKey) return;
    if (
      await confirmDialog({
        title: "Drop column",
        message: `Drop "${column.name}" from "${table}"? All values in this column will be permanently deleted.`,
        confirmLabel: "Drop column",
        danger: true,
      })
    ) {
      setBusy(true);
      await dropColumn(table, column.name);
      onClose();
    }
  };

  return (
    <>
      <div className="bud-pop-backdrop" onClick={onClose} />
      <div className="odb-column-editor" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
        <div className="odb-column-editor-head">
          <div>
            <span>Column</span>
            <strong>{column.name}</strong>
          </div>
          {column.isPrimaryKey && (
            <span className="odb-column-key">
              <IconKey size={12} stroke={2} />
              Primary key
            </span>
          )}
        </div>

        <label className="odb-column-name">
          <span>Name</span>
          <input
            value={name}
            autoFocus
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") onClose();
            }}
          />
        </label>

        <div className="odb-column-meta">
          <div>
            <span>SQL type</span>
            <code>{column.dataType || "TEXT"}</code>
          </div>
          <div>
            <span>Nullable</span>
            <b>{column.nullable ? "YES" : "NO"}</b>
          </div>
          <div>
            <span>Key</span>
            <b>{column.isPrimaryKey ? "PRIMARY" : "—"}</b>
          </div>
        </div>

        <div className="odb-column-note">
          Type, nullability and key changes are read-only here until OrbitoDB can generate engine-safe migrations.
        </div>

        <button
          className="odb-column-ddl"
          onClick={() => {
            void showTableDdl(table);
            onClose();
          }}
        >
          <IconCode size={14} stroke={1.8} />
          Open table DDL
        </button>

        <div className="odb-column-actions">
          <button
            className="danger"
            onClick={() => void del()}
            disabled={busy || readOnly || column.isPrimaryKey}
            title={column.isPrimaryKey ? "Primary-key columns cannot be dropped here" : "Drop column"}
          >
            <IconTrash size={13} stroke={1.8} />
            Drop
          </button>
          <span />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => void save()} disabled={busy || readOnly || !dirty}>
            Rename
          </button>
        </div>
      </div>
    </>
  );
}
