import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconCode,
  IconCopy,
  IconKey,
  IconLock,
  IconPlus,
  IconTablePlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef, Engine } from "../../ipc/types";
import {
  createTableSqlPreview,
  dataTypeOptions,
  hasTableDesignIssues,
  normalizeDataType,
  supportsAutoIncrement,
  tableDesignIssues,
} from "../../lib/schemaDesign";
import { backdropV, centeredModalV, MotionButton } from "../../lib/motion";
import { confirmDialog, useDialog } from "../../state/dialog";
import { useStore } from "../../state/store";
import "./modal-workspace.css";
import "./schema-designer.css";

interface DraftColumn extends ColumnDef {
  id: string;
}

let draftColumnId = 0;

function makeColumn(engine: Engine, index = 0): DraftColumn {
  const primary = index === 0;
  return {
    id: `column-${++draftColumnId}`,
    name: primary ? "id" : "",
    dataType: primary ? (engine === "mysql" ? "BIGINT" : "INTEGER") : "TEXT",
    nullable: !primary,
    primaryKey: primary,
    autoIncrement: primary,
  };
}

function designFingerprint(tableName: string, columns: DraftColumn[]): string {
  return JSON.stringify({
    tableName,
    columns: columns.map(({ name, dataType, nullable, primaryKey, autoIncrement }) => ({
      name,
      dataType,
      nullable,
      primaryKey,
      autoIncrement: !!autoIncrement,
    })),
  });
}

function engineLabel(engine: Engine): string {
  if (engine === "postgres") return "PostgreSQL";
  if (engine === "mysql") return "MySQL / MariaDB";
  return "SQLite";
}

export function CreateTableModal({ initialOpen = false }: { initialOpen?: boolean }) {
  const connection = useStore((state) => state.connections.find((item) => item.id === state.activeConnectionId));
  const schemaTables = useStore((state) => state.schema.tables);
  const readOnly = useStore((state) => state.readOnlyConns.includes(state.activeConnectionId ?? ""));
  const createTable = useStore((state) => state.createTable);
  const openTableData = useStore((state) => state.openTableData);
  const engine = connection?.engine ?? "sqlite";

  const [open, setOpen] = useState(() => initialOpen && !!connection);
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<DraftColumn[]>(() => [makeColumn(engine)]);
  const [baseline, setBaseline] = useState(() => designFingerprint("", [makeColumn(engine)]));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const tableNameRef = useRef<HTMLInputElement>(null);
  const requestCloseRef = useRef<() => Promise<void>>(async () => {});

  const reset = useCallback(() => {
    const initialColumns = [makeColumn(engine)];
    setTableName("");
    setColumns(initialColumns);
    setBaseline(designFingerprint("", initialColumns));
    setSubmitted(false);
    setBusy(false);
    setCopied(false);
  }, [engine]);

  useEffect(() => {
    const show = () => {
      if (!useStore.getState().activeConnectionId) return;
      reset();
      setOpen(true);
    };
    window.addEventListener("orbitodb:create-table", show);
    return () => window.removeEventListener("orbitodb:create-table", show);
  }, [reset]);

  const fingerprint = designFingerprint(tableName, columns);
  const dirty = fingerprint !== baseline;
  const existingNames = useMemo(() => schemaTables.map((table) => table.name), [schemaTables]);
  const issues = useMemo(
    () => tableDesignIssues(engine, tableName, columns, existingNames),
    [columns, engine, existingNames, tableName],
  );
  const invalid = hasTableDesignIssues(issues);
  const preview = useMemo(
    () => createTableSqlPreview(engine, tableName, columns),
    [columns, engine, tableName],
  );
  const typeOptions = useMemo(() => dataTypeOptions(engine), [engine]);

  const requestClose = useCallback(async () => {
    if (busy) return;
    if (dirty && !(await confirmDialog({
      title: "Discard table design?",
      message: "The table name and column definitions entered here have not been created.",
      confirmLabel: "Discard design",
      danger: true,
    }))) return;
    setOpen(false);
  }, [busy, dirty]);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => tableNameRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (useDialog.getState().current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
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
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open]);

  const updateColumn = (id: string, patch: Partial<DraftColumn>) => {
    setColumns((current) => current.map((column) => {
      if (column.id !== id) return column;
      const next = { ...column, ...patch };
      if (patch.dataType != null && next.autoIncrement && !supportsAutoIncrement(engine, next.dataType)) {
        next.autoIncrement = false;
      }
      return next;
    }));
  };

  const togglePrimaryKey = (id: string) => {
    setColumns((current) => {
      const target = current.find((column) => column.id === id);
      const enable = !target?.primaryKey;
      return current.map((column) => {
        if (column.id === id) {
          return {
            ...column,
            primaryKey: enable,
            nullable: enable ? false : column.nullable,
            autoIncrement: enable ? !!column.autoIncrement : false,
          };
        }
        return { ...column, primaryKey: false, autoIncrement: false };
      });
    });
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= columns.length) return;
    setColumns((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const create = async () => {
    setSubmitted(true);
    if (invalid || readOnly || !connection) return;
    setBusy(true);
    const name = tableName.trim();
    const definitions: ColumnDef[] = columns.map(({ id: _id, ...column }) => ({
      ...column,
      name: column.name.trim(),
      dataType: normalizeDataType(column.dataType),
      autoIncrement: !!column.autoIncrement,
    }));
    const created = await createTable(name, definitions);
    if (created) {
      setBaseline(designFingerprint(tableName, columns));
      await openTableData(name);
      setOpen(false);
    }
    setBusy(false);
  };

  const copyPreview = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (!open || !connection) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="bud-modal-backdrop"
        variants={backdropV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={() => void requestClose()}
      />
      <motion.div
        ref={modalRef}
        className="bud-modal odb-schema-designer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schema-designer-title"
        aria-describedby="schema-designer-description"
        aria-busy={busy}
        variants={centeredModalV}
        initial="hidden"
        animate="show"
        exit="exit"
      >
        <header className="bud-modal-head odb-schema-head">
          <div className="odb-schema-title-wrap">
            <span className="odb-schema-title-icon"><IconTablePlus size={18} stroke={1.7} /></span>
            <div>
              <span className="bud-modal-eyebrow">Schema designer</span>
              <h2 id="schema-designer-title">Create a table</h2>
              <p id="schema-designer-description">Define a safe, portable starting schema before it reaches the database.</p>
            </div>
          </div>
          <div className="odb-schema-context">
            <span>{engineLabel(engine)}</span>
            <strong>{connection.name}</strong>
          </div>
          <button className="bud-modal-close" onClick={() => void requestClose()} aria-label="Close table designer" disabled={busy}>
            <IconX size={18} stroke={1.7} />
          </button>
        </header>

        <div className="bud-modal-body odb-schema-body">
          {readOnly && (
            <div className="odb-schema-callout warning" role="status">
              <IconLock size={16} stroke={1.8} />
              <span><strong>Read-only protection is enabled</strong>Disable it in connection settings before creating this table.</span>
            </div>
          )}

          <section className="odb-schema-section identity" aria-labelledby="schema-table-name-heading">
            <div className="odb-schema-section-copy">
              <span>Table</span>
              <h3 id="schema-table-name-heading">Name the resource</h3>
              <p>Use a portable identifier so queries work consistently across every supported engine.</p>
            </div>
            <label className={`odb-schema-name-field ${(submitted || tableName) && issues.tableName ? "has-error" : ""}`}>
              <span>Table name</span>
              <input
                ref={tableNameRef}
                value={tableName}
                onChange={(event) => setTableName(event.target.value)}
                placeholder="e.g. audit_events"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!((submitted || tableName) && issues.tableName)}
                aria-describedby={(submitted || tableName) && issues.tableName ? "schema-table-name-error" : "schema-table-name-help"}
                disabled={busy}
              />
              {(submitted || tableName) && issues.tableName ? (
                <small id="schema-table-name-error">{issues.tableName}</small>
              ) : (
                <small id="schema-table-name-help">Letters, numbers, and underscores · maximum 63 characters</small>
              )}
            </label>
          </section>

          <section className="odb-schema-section columns" aria-labelledby="schema-columns-heading">
            <div className="odb-schema-section-bar">
              <div className="odb-schema-section-copy">
                <span>Columns</span>
                <h3 id="schema-columns-heading">Define the initial structure</h3>
                <p>{columns.length} {columns.length === 1 ? "column" : "columns"} · {columns.some((column) => column.primaryKey) ? "Primary key configured" : "No primary key"}</p>
              </div>
              <button type="button" className="odb-schema-add" onClick={() => setColumns((current) => [...current, makeColumn(engine, current.length)])} disabled={busy}>
                <IconPlus size={14} stroke={2} /> Add column
              </button>
            </div>

            <div className="odb-schema-grid-head" aria-hidden="true">
              <span>Order</span><span>Name</span><span>Data type</span><span>Constraints</span><span>Actions</span>
            </div>
            <div className="odb-schema-columns">
              {columns.map((column, index) => {
                const nameError = (submitted || column.name) ? issues.columnNames[index] : null;
                const typeError = (submitted || column.dataType) ? issues.columnTypes[index] : null;
                const autoSupported = supportsAutoIncrement(engine, column.dataType);
                return (
                  <div className={`odb-schema-column ${nameError || typeError ? "has-error" : ""}`} key={column.id}>
                    <div className="odb-schema-order">
                      <span>{index + 1}</span>
                      <div>
                        <button type="button" aria-label={`Move ${column.name || `column ${index + 1}`} up`} onClick={() => moveColumn(index, -1)} disabled={busy || index === 0}><IconArrowUp size={12} /></button>
                        <button type="button" aria-label={`Move ${column.name || `column ${index + 1}`} down`} onClick={() => moveColumn(index, 1)} disabled={busy || index === columns.length - 1}><IconArrowDown size={12} /></button>
                      </div>
                    </div>
                    <label className="odb-schema-cell name">
                      <span className="sr-only">Column {index + 1} name</span>
                      <input
                        value={column.name}
                        onChange={(event) => updateColumn(column.id, { name: event.target.value })}
                        placeholder="column_name"
                        spellCheck={false}
                        aria-invalid={!!nameError}
                        disabled={busy}
                      />
                      {nameError && <small>{nameError}</small>}
                    </label>
                    <label className="odb-schema-cell type">
                      <span className="sr-only">Column {index + 1} data type</span>
                      <input
                        list={`schema-types-${engine}`}
                        value={column.dataType}
                        onChange={(event) => updateColumn(column.id, { dataType: event.target.value })}
                        onBlur={(event) => updateColumn(column.id, { dataType: normalizeDataType(event.target.value) })}
                        placeholder="TEXT"
                        spellCheck={false}
                        aria-invalid={!!typeError}
                        disabled={busy}
                      />
                      {typeError && <small>{typeError}</small>}
                    </label>
                    <div className="odb-schema-constraints">
                      <button type="button" className={column.primaryKey ? "is-on" : ""} aria-pressed={column.primaryKey} onClick={() => togglePrimaryKey(column.id)} disabled={busy} title="Use as the table primary key">
                        <IconKey size={12} stroke={1.9} /> Primary
                      </button>
                      <button type="button" className={column.autoIncrement ? "is-on" : ""} aria-pressed={!!column.autoIncrement} onClick={() => updateColumn(column.id, { autoIncrement: !column.autoIncrement })} disabled={busy || !column.primaryKey || !autoSupported} title={!column.primaryKey ? "Choose this column as the primary key first" : !autoSupported ? "Auto-increment requires an integer type" : "Generate increasing values automatically"}>
                        <IconPlus size={12} stroke={2} /> Auto
                      </button>
                      <button type="button" className={column.nullable ? "is-on" : ""} aria-pressed={column.nullable} onClick={() => updateColumn(column.id, { nullable: !column.nullable })} disabled={busy || column.primaryKey} title={column.primaryKey ? "Primary keys cannot be nullable" : "Allow NULL values"}>
                        Null
                      </button>
                    </div>
                    <button type="button" className="odb-schema-remove" aria-label={`Remove ${column.name || `column ${index + 1}`}`} onClick={() => setColumns((current) => current.filter((item) => item.id !== column.id))} disabled={busy || columns.length === 1} title={columns.length === 1 ? "A table needs at least one column" : "Remove column"}>
                      <IconTrash size={14} stroke={1.7} />
                    </button>
                  </div>
                );
              })}
            </div>
            <datalist id={`schema-types-${engine}`}>
              {typeOptions.map((type) => <option key={type} value={type} />)}
            </datalist>
            {issues.form && (
              <div className="odb-schema-callout error" role="alert">
                <IconAlertTriangle size={15} stroke={1.8} /> <span>{issues.form}</span>
              </div>
            )}
          </section>

          <section className="odb-schema-section preview" aria-labelledby="schema-preview-heading">
            <div className="odb-schema-section-bar">
              <div className="odb-schema-section-copy">
                <span>Review</span>
                <h3 id="schema-preview-heading">SQL preview</h3>
                <p>This exact structure will be generated for {engineLabel(engine)}.</p>
              </div>
              <button type="button" className="odb-schema-copy" onClick={() => void copyPreview()}>
                {copied ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={1.8} />}
                {copied ? "Copied" : "Copy SQL"}
              </button>
            </div>
            <pre tabIndex={0}><code><IconCode size={14} stroke={1.7} />{preview}</code></pre>
          </section>
        </div>

        <footer className="bud-modal-actions odb-schema-actions">
          <div className="odb-schema-summary">
            <IconTablePlus size={15} stroke={1.7} />
            <span><strong>{tableName.trim() || "Untitled table"}</strong><small>{columns.length} {columns.length === 1 ? "column" : "columns"} · {engineLabel(engine)}</small></span>
          </div>
          <MotionButton className="bud-modal-cancel" onClick={() => void requestClose()} disabled={busy}>Cancel</MotionButton>
          <MotionButton className="bud-modal-save" onClick={() => void create()} disabled={busy || readOnly || invalid} title={readOnly ? "Disable read-only mode first" : invalid ? "Resolve the highlighted schema issues" : undefined}>
            {busy ? "Creating…" : "Create and open"}
          </MotionButton>
        </footer>
      </motion.div>
    </AnimatePresence>
  );
}
