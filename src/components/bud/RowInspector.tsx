import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceFloppy,
  IconLock,
  IconRefresh,
  IconSearch,
  IconTable,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { matchesRecordField, sameCellValue } from "../../lib/rowInspector";
import { useStore } from "../../state/store";
import "./row-inspector.css";

// Kept in its own lazy-loaded chunk so the dense editor does not tax startup.
type Col = { name: string; dataType: string };
type Kind = "number" | "date" | "datetime" | "bool" | "select" | "textarea" | "text";

function fieldKind(col: Col, samples: unknown[]): Kind {
  const t = col.dataType.toUpperCase();
  const name = col.name.toLowerCase();
  if (/BOOL/.test(t)) return "bool";
  if (/INT|SERIAL|NUM|DEC|REAL|FLOAT|DOUBLE|BIGINT/.test(t)) return "number";
  if (/TIMESTAMP|DATETIME/.test(t)) return "datetime";
  if (/DATE/.test(t)) return "date";
  const nonNull = samples.filter((v) => v != null).map(String);
  if (nonNull.length > 0 && nonNull.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))) return "date";
  if (nonNull.length > 0 && nonNull.every((s) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s))) return "datetime";
  if (/(comment|description|note|body|content|message|summary|bio|address)/.test(name)) return "textarea";
  const distinct = new Set(nonNull);
  if (distinct.size > 0 && distinct.size <= 12 && [...distinct].every((s) => s.length <= 28)) return "select";
  const maxLen = Math.max(0, ...nonNull.map((s) => s.length));
  if (/TEXT|CLOB/.test(t) && maxLen > 60) return "textarea";
  return "text";
}

function FieldInput({
  id,
  kind,
  value,
  disabled,
  samples,
  onChange,
}: {
  id: string;
  kind: Kind;
  value: unknown;
  disabled: boolean;
  samples: unknown[];
  onChange: (v: unknown) => void;
}) {
  const stringValue = value == null ? "" : String(value);

  if (kind === "bool") {
    const checked = value === true || stringValue === "true" || stringValue === "1" || stringValue === "t";
    return (
      <label className="odb-inspector-bool" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span className="bud-switch" />
        <span>{checked ? "true" : "false"}</span>
      </label>
    );
  }

  if (kind === "select") {
    const distinct = [...new Set(samples.filter((sample) => sample != null).map(String))];
    if (stringValue !== "" && !distinct.includes(stringValue)) distinct.unshift(stringValue);
    return (
      <select id={id} className="odb-inspector-input" value={stringValue} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Empty string</option>
        {distinct.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (kind === "textarea") {
    return (
      <textarea
        id={id}
        className="odb-inspector-input odb-inspector-textarea"
        value={stringValue}
        rows={3}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  let inputType = kind === "number" ? "number" : kind === "date" ? "date" : kind === "datetime" ? "datetime-local" : "text";
  let inputValue = stringValue;
  if (kind === "date") {
    if (/^\d{4}-\d{2}-\d{2}/.test(stringValue)) inputValue = stringValue.slice(0, 10);
    else if (stringValue !== "") inputType = "text";
  } else if (kind === "datetime") {
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(stringValue)) inputValue = stringValue.slice(0, 16).replace(" ", "T");
    else if (stringValue !== "") inputType = "text";
  }
  return (
    <input
      id={id}
      className="odb-inspector-input"
      type={inputType}
      value={inputValue}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function RowInspector() {
  const result = useStore((state) => state.result);
  const editTable = useStore((state) => state.editTable);
  const schemaColumns = useStore((state) => (
    editTable ? state.schema.columnsByTable[editTable.table] : undefined
  ));
  const inspectorRow = useStore((state) => state.inspectorRow);
  const readOnly = useStore((state) => state.readOnlyConns.includes(state.activeConnectionId ?? ""));
  const openInspector = useStore((state) => state.openInspector);
  const closeInspector = useStore((state) => state.closeInspector);
  const setInspectorDirty = useStore((state) => state.setInspectorDirty);
  const editCell = useStore((state) => state.editCell);
  const deleteRowAt = useStore((state) => state.deleteRowAt);

  const pkColumn = editTable?.pkColumn ?? null;
  const pkIndex = useMemo(
    () => (pkColumn && result ? result.columns.findIndex((column) => column.name === pkColumn) : -1),
    [pkColumn, result],
  );
  const samplesByColumn = useMemo(
    () => (result ? result.columns.map((_, columnIndex) => result.rows.map((row) => row[columnIndex])) : []),
    [result],
  );
  const inspectorColumns = useMemo(() => (
    result?.columns.map((column) => ({
      ...column,
      dataType: column.dataType || schemaColumns?.find((candidate) => candidate.name === column.name)?.dataType || "",
    })) ?? []
  ), [result, schemaColumns]);
  const row = result && inspectorRow != null ? result.rows[inspectorRow] : undefined;
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    if (result && inspectorRow != null && result.rows[inspectorRow]) {
      result.columns.forEach((column, index) => {
        initial[column.name] = result.rows[inspectorRow][index];
      });
    }
    return initial;
  });
  const [fieldQuery, setFieldQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const changedColumns = useMemo(() => {
    if (!result || !row) return [];
    return result.columns.flatMap((column, index) => (
      index !== pkIndex && !sameCellValue(draft[column.name], row[index]) ? [index] : []
    ));
  }, [draft, pkIndex, result, row]);
  const changedSet = useMemo(() => new Set(changedColumns), [changedColumns]);
  const changedCount = changedColumns.length;

  useEffect(() => {
    setInspectorDirty(changedCount > 0);
  }, [changedCount, setInspectorDirty]);

  useEffect(() => {
    if (changedCount === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [changedCount]);

  if (!result || !editTable || inspectorRow == null || !row) return null;

  const canEdit = !!pkColumn && pkIndex >= 0 && !readOnly;
  const pkValue = pkIndex >= 0 ? row[pkIndex] : null;
  const visibleFields = inspectorColumns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => matchesRecordField(column, fieldQuery));

  const updateDraft = (name: string, value: unknown) => {
    const nextDraft = { ...draft, [name]: value };
    setDraft(nextDraft);
    setInspectorDirty(result.columns.some((column, index) => (
      index !== pkIndex && !sameCellValue(nextDraft[column.name], row[index])
    )));
    setSaved(false);
  };

  const resetField = (columnIndex: number) => {
    const column = result.columns[columnIndex];
    updateDraft(column.name, row[columnIndex]);
  };

  const resetAll = () => {
    setDraft(Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])));
    setInspectorDirty(false);
    setSaved(false);
  };

  const save = async () => {
    if (!canEdit || busy || changedCount === 0) return;
    setBusy(true);
    setSaved(false);
    for (const columnIndex of changedColumns) {
      const name = result.columns[columnIndex].name;
      if (!(await editCell(inspectorRow, columnIndex, draft[name]))) {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setSaved(true);
    setInspectorDirty(false);
  };

  const moveTo = (nextRow: number) => {
    if (nextRow < 0 || nextRow >= result.rows.length) return;
    void openInspector(nextRow);
  };

  const handleKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void closeInspector();
      return;
    }
    if (event.altKey && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      moveTo(inspectorRow + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1));
    }
  };

  return (
    <>
      <button className="odb-inspector-scrim" aria-label="Close record details" onClick={() => void closeInspector()} />
      <aside className="bud-inspector odb-record-inspector" aria-label="Record details" aria-busy={busy} onKeyDown={handleKeys}>
        <header className="odb-inspector-header">
          <div className="odb-inspector-heading">
            <strong>Record details</strong>
            <span>{editTable.table}</span>
          </div>
          <div className="odb-inspector-nav" aria-label="Record navigation">
            <button type="button" title="Previous record · Alt+↑" aria-label="Previous record" disabled={inspectorRow === 0} onClick={() => moveTo(inspectorRow - 1)}>
              <IconChevronLeft size={15} stroke={1.9} />
            </button>
            <span><strong>{inspectorRow + 1}</strong> / {result.rows.length}</span>
            <button type="button" title="Next record · Alt+↓" aria-label="Next record" disabled={inspectorRow === result.rows.length - 1} onClick={() => moveTo(inspectorRow + 1)}>
              <IconChevronRight size={15} stroke={1.9} />
            </button>
          </div>
          <button type="button" className="odb-inspector-close" title="Close · Esc" aria-label="Close record details" onClick={() => void closeInspector()}>
            <IconX size={17} stroke={1.9} />
          </button>
        </header>

        <div className="odb-inspector-body">
          <div className="odb-inspector-meta">
            <span><IconTable size={14} stroke={1.7} /> {editTable.table}</span>
            {pkValue != null && <code title={`${pkColumn} = ${String(pkValue)}`}>{pkColumn} = {String(pkValue)}</code>}
          </div>

          {!pkColumn || pkIndex < 0 ? (
            <div className="odb-inspector-notice"><IconLock size={15} /> No primary key. This record is read-only.</div>
          ) : readOnly ? (
            <div className="odb-inspector-notice"><IconLock size={15} /> Read-only mode is enabled for this connection.</div>
          ) : null}

          {result.columns.length >= 8 && (
            <div className="odb-inspector-search">
              <IconSearch size={14} stroke={1.8} />
              <input
                value={fieldQuery}
                aria-label="Filter record fields"
                placeholder={`Filter ${result.columns.length} fields…`}
                onChange={(event) => setFieldQuery(event.target.value)}
              />
              {fieldQuery && (
                <button type="button" title="Clear field filter" aria-label="Clear field filter" onClick={() => setFieldQuery("")}>
                  <IconX size={13} stroke={2} />
                </button>
              )}
              <span>{visibleFields.length}</span>
            </div>
          )}

          <div className="odb-inspector-fields">
            {visibleFields.map(({ column, index }) => {
              const isPrimaryKey = index === pkIndex;
              const isModified = changedSet.has(index);
              const isNull = draft[column.name] == null;
              const inputId = `record-field-${inspectorRow}-${index}`;
              const fieldDisabled = isPrimaryKey || !canEdit || isNull || busy;
              return (
                <section className={`odb-inspector-field ${isModified ? "is-modified" : ""} ${isNull ? "is-null" : ""}`} key={column.name}>
                  <div className="odb-inspector-label-row">
                    <label htmlFor={inputId}>{column.name}</label>
                    {column.dataType && <span className="odb-inspector-type">{column.dataType}</span>}
                    {isPrimaryKey && <span className="odb-inspector-pk">PK</span>}
                    {isModified && <span className="odb-inspector-modified">Modified</span>}
                    {isModified && (
                      <button type="button" title={`Reset ${column.name}`} aria-label={`Reset ${column.name}`} onClick={() => resetField(index)}>
                        <IconRefresh size={12} stroke={1.9} />
                      </button>
                    )}
                  </div>
                  <div className="odb-inspector-control-row">
                    <div className="odb-inspector-input-wrap">
                      {isNull && <span className="odb-inspector-null-value">NULL</span>}
                      <FieldInput
                        id={inputId}
                        kind={fieldKind(column, samplesByColumn[index] ?? [])}
                        value={draft[column.name]}
                        disabled={fieldDisabled}
                        samples={samplesByColumn[index] ?? []}
                        onChange={(value) => updateDraft(column.name, value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="odb-inspector-null-toggle"
                      aria-label={`${isNull ? "Unset" : "Set"} ${column.name} as NULL`}
                      aria-pressed={isNull}
                      title={isNull ? "Use a value" : "Set as NULL"}
                      disabled={isPrimaryKey || !canEdit || busy}
                      onClick={() => updateDraft(column.name, isNull ? "" : null)}
                    >
                      NULL
                    </button>
                  </div>
                </section>
              );
            })}
          </div>

          {visibleFields.length === 0 && (
            <div className="odb-inspector-empty">
              <IconSearch size={18} stroke={1.6} />
              <strong>No matching fields</strong>
              <span>Try a field name or data type.</span>
            </div>
          )}
        </div>

        <footer className="odb-inspector-footer">
          <button type="button" className="odb-inspector-delete" onClick={() => void deleteRowAt(inspectorRow)} disabled={!canEdit || busy}>
            <IconTrash size={15} stroke={1.8} /> Delete
          </button>
          <div className="odb-inspector-status" aria-live="polite">
            {saved && changedCount === 0 ? <span className="is-saved"><IconCheck size={13} /> Saved</span> : changedCount > 0 ? <span>{changedCount} modified</span> : <span>No changes</span>}
          </div>
          {changedCount > 0 && (
            <button type="button" className="odb-inspector-reset" onClick={resetAll} disabled={busy}>Reset</button>
          )}
          <button type="button" className="odb-inspector-save" onClick={() => void save()} disabled={!canEdit || busy || changedCount === 0} title="Save changes · ⌘S">
            <IconDeviceFloppy size={15} stroke={1.9} /> {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </aside>
    </>
  );
}
