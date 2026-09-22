import { IconCode, IconKey, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { confirmDialog } from "../../state/dialog";
import type { ColumnInfo } from "../../ipc/types";
import { useStore } from "../../state/store";

export interface ColumnEditorAnchor {
  column: ColumnInfo;
  x: number;
  y: number;
}

/** Honest schema editor: only expose operations the backend can apply safely. */
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
  const [name, setName] = useState(column.name);
  const [busy, setBusy] = useState(false);

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 340));
  const top = Math.max(8, Math.min(anchor.y + 4, window.innerHeight - 330));

  const save = async () => {
    const next = name.trim();
    if (!next || next === column.name) {
      onClose();
      return;
    }
    setBusy(true);
    const renamed = await renameColumn(table, column.name, next);
    setBusy(false);
    if (renamed) onClose();
  };

  const del = async () => {
    if (
      await confirmDialog({
        title: "Delete column",
        message: `Delete “${column.name}”? This drops the column and all of its data.`,
        confirmLabel: "Delete column",
        danger: true,
      })
    ) {
      setBusy(true);
      const deleted = await dropColumn(table, column.name);
      setBusy(false);
      if (deleted) onClose();
    }
  };

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="bud-pop-backdrop" onClick={onClose} />
      <div
        className="bud-coleditor"
        style={{ left, top }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="column-editor-title"
        onKeyDown={onDialogKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bud-ce-head">
          <div>
            <span className="bud-ce-eyebrow">Column</span>
            <h2 id="column-editor-title">Edit {column.name}</h2>
          </div>
          {column.isPrimaryKey && (
            <span className="bud-ce-key"><IconKey size={12} stroke={1.9} /> Primary key</span>
          )}
        </div>

        <label className="bud-ce-field">
          <span>Column name</span>
          <input
            className="bud-ce-name"
            value={name}
            autoFocus
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
          />
        </label>

        <dl className="bud-ce-meta">
          <div><dt>Database type</dt><dd><code>{column.dataType || "TEXT"}</code></dd></div>
          <div><dt>Nullable</dt><dd>{column.nullable ? "Yes" : "No"}</dd></div>
        </dl>

        <div className="bud-ce-note">
          Type, nullability, and default changes use engine-specific SQL. Review the table definition before altering them.
          <button
            onClick={() => {
              void showTableDdl(table);
              onClose();
            }}
          >
            <IconCode size={13} stroke={1.8} /> Open table DDL
          </button>
        </div>

        <div className="bud-ce-actions">
          <button
            className="bud-ce-delete"
            onClick={() => void del()}
            disabled={busy || column.isPrimaryKey}
            title={column.isPrimaryKey ? "The primary key can't be dropped here" : "Drop this column"}
          >
            <IconTrash size={13} stroke={1.8} /> Delete
          </button>
          <button className="bud-ce-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="bud-ce-save" onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save name"}
          </button>
        </div>
      </div>
    </>
  );
}
