import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconColumns3,
  IconFileImport,
  IconInfoCircle,
  IconRefresh,
  IconTable,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fromCsv, inferColumns, type DelimitedParseResult } from "../../lib/csv";
import { backdropV, centeredModalV, MotionButton } from "../../lib/motion";
import { confirmDialog } from "../../state/dialog";
import { useStore } from "../../state/store";
import { toast } from "../../state/toast";
import "./modal-workspace.css";
import "./import-workspace.css";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

interface ParsedFile extends DelimitedParseResult {
  fileName: string;
  fileSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function delimiterLabel(delimiter: DelimitedParseResult["delimiter"]): string {
  if (delimiter === "\t") return "Tab-separated";
  if (delimiter === ";") return "Semicolon-separated";
  return "Comma-separated";
}

function autoMap(headers: string[], columns: string[]): Record<number, string> {
  const used = new Set<string>();
  return Object.fromEntries(headers.map((header, index) => {
    const match = columns.find((column) => (
      !used.has(column) && column.toLocaleLowerCase() === header.toLocaleLowerCase()
    ));
    if (match) used.add(match);
    return [index, match ?? ""];
  }));
}

/** Import a delimited file into a new or existing table. */
export function ImportCsvModal({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(() => initialOpen && !!useStore.getState().activeConnectionId);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mode, setMode] = useState<"create" | "append">("create");
  const [tableName, setTableName] = useState("");
  const [target, setTarget] = useState("");
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const tableNameRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const initialOpenHandled = useRef(false);
  const requestCloseRef = useRef<() => Promise<void>>(async () => {});

  const tables = useStore((state) => state.schema.tables);
  const schema = useStore((state) => state.schema);
  const activeId = useStore((state) => state.activeConnectionId);
  const readOnly = useStore((state) => state.readOnlyConns.includes(state.activeConnectionId ?? ""));
  const importCsv = useStore((state) => state.importCsv);
  const expandTable = useStore((state) => state.expandTable);
  const appendableTables = useMemo(
    () => tables.filter((table) => table.kind.toLocaleLowerCase() !== "view"),
    [tables],
  );
  const targetColumns = target ? schema.columnsByTable[target] : undefined;

  const resetWorkflow = useCallback(() => {
    setParsed(null);
    setMode("create");
    setTableName("");
    setTarget("");
    setMapping({});
    setDragging(false);
    setBusy(false);
    setProgress({ completed: 0, total: 0 });
  }, []);

  const closeNow = useCallback(() => {
    setOpen(false);
    resetWorkflow();
  }, [resetWorkflow]);

  const requestClose = useCallback(async () => {
    if (busy) return;
    if (parsed && !(await confirmDialog({
      title: "Discard this import?",
      message: "The selected file, destination, and column mapping will be cleared.",
      confirmLabel: "Discard import",
      danger: true,
    }))) return;
    closeNow();
  }, [busy, closeNow, parsed]);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    if (initialOpenHandled.current) return;
    initialOpenHandled.current = true;
    if (initialOpen && !useStore.getState().activeConnectionId) toast("Open a connection first.", "error");
  }, [initialOpen]);

  useEffect(() => {
    const onOpen = () => {
      if (!useStore.getState().activeConnectionId) {
        toast("Open a connection first.", "error");
        return;
      }
      resetWorkflow();
      setOpen(true);
    };
    window.addEventListener("orbitodb:import-csv", onOpen);
    return () => window.removeEventListener("orbitodb:import-csv", onOpen);
  }, [resetWorkflow]);

  useEffect(() => {
    if (appendableTables.length === 0) {
      if (target) setTarget("");
      return;
    }
    if (!appendableTables.some((table) => table.name === target)) {
      setTarget(appendableTables[0].name);
    }
  }, [appendableTables, target]);

  useEffect(() => {
    if (!open || mode !== "append" || !target || targetColumns) return;
    void expandTable(target);
  }, [expandTable, mode, open, target, targetColumns]);

  useEffect(() => {
    if (!parsed || mode !== "append" || !targetColumns) return;
    setMapping(autoMap(parsed.headers, targetColumns.map((column) => column.name)));
  }, [mode, parsed, target, targetColumns]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const frame = window.requestAnimationFrame(() => (
      modalRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0]
    )?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
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

  const onFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast("That file is larger than the 25 MB import limit.", "error");
      return;
    }
    try {
      const text = await file.text();
      const forcedDelimiter = /\.tsv$/i.test(file.name) ? "\t" as const : undefined;
      const result = fromCsv(text, forcedDelimiter);
      if (result.headers.length === 0) {
        toast("That file has no header row.", "error");
        return;
      }
      const base = file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^\p{L}\p{N}_]+/gu, "_")
        .replace(/^_+|_+$/g, "");
      setParsed({ ...result, fileName: file.name, fileSize: file.size });
      setTableName(base || "imported_data");
      setMode("create");
      setMapping({});
      window.requestAnimationFrame(() => tableNameRef.current?.focus());
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not read that file.", "error");
    }
  };

  const inferredColumns = useMemo(
    () => (parsed ? inferColumns(parsed.headers, parsed.rows) : []),
    [parsed],
  );
  const mappedEntries = parsed
    ? parsed.headers.flatMap((header, index) => mapping[index] ? [{ header, index, target: mapping[index] }] : [])
    : [];
  const mappedTargets = mappedEntries.map((entry) => entry.target);
  const duplicateTargets = new Set(mappedTargets.filter((targetName, index) => mappedTargets.indexOf(targetName) !== index));
  const structuralError = !!parsed && (
    parsed.unterminatedQuote || parsed.malformedRows.length > 0 || parsed.rows.length === 0
  );
  const nameCollision = mode === "create" && !!tableName.trim() && tables.some(
    (table) => table.name.toLocaleLowerCase() === tableName.trim().toLocaleLowerCase(),
  );
  const mappingReady = mode === "create" || (
    !!target && !!targetColumns && mappedEntries.length > 0 && duplicateTargets.size === 0
  );
  const destinationReady = mode === "create" ? !!tableName.trim() && !nameCollision : !!target;
  const canImport = !!parsed && !structuralError && destinationReady && mappingReady && !readOnly && !busy;
  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  const run = async () => {
    if (!parsed || !activeId || !canImport) return;
    const destination = mode === "create" ? tableName.trim() : target;
    const headers = mode === "create" ? parsed.headers : mappedEntries.map((entry) => entry.target);
    const rows = mode === "create"
      ? parsed.rows
      : parsed.rows.map((row) => mappedEntries.map((entry) => row[entry.index] ?? ""));
    setBusy(true);
    setProgress({ completed: 0, total: rows.length });
    const imported = await importCsv(destination, headers, rows, {
      create: mode === "create",
      onProgress: (completed, total) => setProgress({ completed, total }),
    });
    setBusy(false);
    if (imported) closeNow();
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="import-bg"
            className="bud-modal-backdrop"
            variants={backdropV}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={() => void requestClose()}
          />
        )}
        {open && (
          <motion.div
            key="import-modal"
            ref={modalRef}
            className="bud-modal bud-import odb-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-csv-title"
            aria-describedby="import-csv-description"
            aria-busy={busy}
            variants={centeredModalV}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="bud-modal-head odb-import-head">
              <div>
                <span className="bud-modal-eyebrow">Data import</span>
                <h2 id="import-csv-title"><IconFileImport size={18} stroke={1.7} /> Import delimited data</h2>
                <p id="import-csv-description">Review the structure, map columns, and import without losing context.</p>
              </div>
              <div className="odb-import-head-actions">
                <ol className="odb-import-steps" aria-label="Import progress">
                  <li className={!parsed ? "current" : "done"}><span>{parsed ? <IconCheck size={10} /> : "1"}</span>File</li>
                  <li className={parsed && !busy ? "current" : parsed ? "done" : ""}><span>{busy ? <IconCheck size={10} /> : "2"}</span>Configure</li>
                  <li className={busy ? "current" : ""}><span>3</span>Import</li>
                </ol>
                <button type="button" className="bud-modal-close" onClick={() => void requestClose()} aria-label="Close data import" disabled={busy}>
                  <IconX size={18} stroke={1.7} />
                </button>
              </div>
            </header>

            <div className="bud-modal-body odb-import-body">
              {!parsed ? (
                <button
                  type="button"
                  className={`odb-import-drop ${dragging ? "is-dragging" : ""}`}
                  data-autofocus
                  onClick={() => fileRef.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    const file = event.dataTransfer.files[0];
                    if (file) void onFile(file);
                  }}
                >
                  <span className="odb-import-drop-icon"><IconUpload size={24} stroke={1.55} /></span>
                  <strong>{dragging ? "Drop the file here" : "Choose or drop a data file"}</strong>
                  <span>CSV, TSV, or semicolon-separated text · up to 25 MB</span>
                  <small>Quoted values, escaped quotes, and multiline cells are supported.</small>
                </button>
              ) : (
                <div className="odb-import-workspace">
                  <section className="odb-import-filebar" aria-label="Selected file">
                    <span className="odb-import-file-icon"><IconFileImport size={17} stroke={1.7} /></span>
                    <div>
                      <strong title={parsed.fileName}>{parsed.fileName}</strong>
                      <span>{formatBytes(parsed.fileSize)} · {delimiterLabel(parsed.delimiter)}</span>
                    </div>
                    <dl>
                      <div><dt>Rows</dt><dd>{parsed.rows.length.toLocaleString()}</dd></div>
                      <div><dt>Columns</dt><dd>{parsed.headers.length.toLocaleString()}</dd></div>
                    </dl>
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
                      <IconRefresh size={13} stroke={1.8} /> Replace
                    </button>
                  </section>

                  {readOnly && (
                    <div className="odb-import-callout warning" role="status">
                      <IconAlertTriangle size={15} stroke={1.8} />
                      <span><strong>Read-only connection</strong>Disable read-only mode before importing data.</span>
                    </div>
                  )}
                  {parsed.unterminatedQuote && (
                    <div className="odb-import-callout danger" role="alert">
                      <IconAlertTriangle size={15} stroke={1.8} />
                      <span><strong>Unclosed quoted value</strong>The file ends before a quoted field is closed.</span>
                    </div>
                  )}
                  {parsed.malformedRows.length > 0 && (
                    <div className="odb-import-callout danger" role="alert">
                      <IconAlertTriangle size={15} stroke={1.8} />
                      <span>
                        <strong>{parsed.malformedRows.length.toLocaleString()} malformed {parsed.malformedRows.length === 1 ? "row" : "rows"}</strong>
                        Expected {parsed.headers.length} values in every row. Check records {parsed.malformedRows.slice(0, 5).join(", ")}{parsed.malformedRows.length > 5 ? "…" : ""}.
                      </span>
                    </div>
                  )}
                  {parsed.rows.length === 0 && (
                    <div className="odb-import-callout warning" role="alert">
                      <IconInfoCircle size={15} stroke={1.8} />
                      <span><strong>No data rows</strong>Add at least one row below the header before importing.</span>
                    </div>
                  )}
                  {(parsed.normalizedHeaders > 0 || parsed.skippedEmptyRows > 0) && !parsed.unterminatedQuote && (
                    <div className="odb-import-callout info" role="status">
                      <IconInfoCircle size={15} stroke={1.8} />
                      <span>
                        <strong>File cleaned safely</strong>
                        {parsed.normalizedHeaders > 0 ? `${parsed.normalizedHeaders} header name${parsed.normalizedHeaders === 1 ? " was" : "s were"} normalized. ` : ""}
                        {parsed.skippedEmptyRows > 0 ? `${parsed.skippedEmptyRows} empty ${parsed.skippedEmptyRows === 1 ? "row was" : "rows were"} skipped.` : ""}
                      </span>
                    </div>
                  )}

                  <div className="odb-import-mode" role="radiogroup" aria-label="Import destination type">
                    <label className={mode === "create" ? "is-selected" : ""}>
                      <input type="radio" name="import-mode" checked={mode === "create"} onChange={() => setMode("create")} disabled={busy} />
                      <IconTable size={16} stroke={1.7} />
                      <span><strong>Create new table</strong><small>Infer a schema from this file</small></span>
                    </label>
                    <label className={`${mode === "append" ? "is-selected" : ""} ${appendableTables.length === 0 ? "is-disabled" : ""}`}>
                      <input type="radio" name="import-mode" checked={mode === "append"} disabled={appendableTables.length === 0 || busy} onChange={() => setMode("append")} />
                      <IconColumns3 size={16} stroke={1.7} />
                      <span><strong>Append to table</strong><small>Map source fields to existing columns</small></span>
                    </label>
                  </div>

                  <section className="odb-import-destination" aria-labelledby="import-destination-title">
                    <div className="odb-import-section-head">
                      <div><span>Destination</span><h3 id="import-destination-title">{mode === "create" ? "Name the new table" : "Choose a table and map columns"}</h3></div>
                      <span className="odb-import-section-count">Step 2 of 3</span>
                    </div>
                    {mode === "create" ? (
                      <label className={`bud-field ${nameCollision ? "has-error" : ""}`}>
                        <span>Table name</span>
                        <input ref={tableNameRef} value={tableName} onChange={(event) => setTableName(event.target.value)} placeholder="e.g. quarterly_revenue" disabled={busy} />
                        {nameCollision
                          ? <small className="odb-import-field-error">A table or view with this name already exists.</small>
                          : <small>Column names and types are inferred from the preview below.</small>}
                      </label>
                    ) : (
                      <>
                        <label className="bud-field odb-import-target">
                          <span>Target table</span>
                          <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}>
                            {appendableTables.map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
                          </select>
                        </label>
                        {!targetColumns ? (
                          <div className="odb-import-mapping-loading" role="status"><span className="bud-loading-spinner" /> Loading table columns…</div>
                        ) : (
                          <div className="odb-import-mapping">
                            <div className="odb-import-mapping-head"><span>Source field</span><span>Target column</span><span>Example</span></div>
                            {parsed.headers.map((header, index) => {
                              const selectedElsewhere = new Set(Object.entries(mapping).flatMap(([sourceIndex, column]) => (
                                Number(sourceIndex) !== index && column ? [column] : []
                              )));
                              const example = parsed.rows.find((row) => (row[index] ?? "") !== "")?.[index] ?? "Empty";
                              return (
                                <label className={!mapping[index] ? "is-skipped" : ""} key={`${header}-${index}`}>
                                  <span title={header}>{header}</span>
                                  <span className="odb-import-map-arrow"><IconArrowRight size={13} stroke={1.8} /></span>
                                  <select
                                    aria-label={`Map ${header}`}
                                    value={mapping[index] ?? ""}
                                    disabled={busy}
                                    onChange={(event) => setMapping((current) => ({ ...current, [index]: event.target.value }))}
                                  >
                                    <option value="">Skip this field</option>
                                    {targetColumns.map((column) => (
                                      <option key={column.name} value={column.name} disabled={selectedElsewhere.has(column.name)}>
                                        {column.name} · {column.dataType || "value"}
                                      </option>
                                    ))}
                                  </select>
                                  <code title={example}>{example}</code>
                                </label>
                              );
                            })}
                            <div className="odb-import-mapping-summary">
                              <IconCheck size={13} stroke={2} /> {mappedEntries.length} of {parsed.headers.length} source fields will be imported
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </section>

                  <section className="odb-import-preview" aria-labelledby="import-preview-title">
                    <div className="odb-import-section-head">
                      <div><span>Preview</span><h3 id="import-preview-title">First {Math.min(8, parsed.rows.length)} rows</h3></div>
                      <span className="odb-import-section-count">{parsed.rows.length.toLocaleString()} total</span>
                    </div>
                    <div className="odb-import-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th className="odb-import-rownum">#</th>
                            {parsed.headers.map((header, index) => (
                              <th className={mode === "append" && !mapping[index] ? "is-skipped" : ""} key={`${header}-${index}`}>
                                <span>{header}</span>
                                <small>{mode === "create" ? inferredColumns[index]?.dataType : mapping[index] || "Skipped"}</small>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.rows.slice(0, 8).map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              <td className="odb-import-rownum">{rowIndex + 1}</td>
                              {parsed.headers.map((header, columnIndex) => (
                                <td className={mode === "append" && !mapping[columnIndex] ? "is-skipped" : ""} title={row[columnIndex] ?? ""} key={`${header}-${columnIndex}`}>
                                  {row[columnIndex] || <span className="odb-import-empty-value">empty</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {parsed.rows.length > 8 && <div className="odb-import-more">+ {(parsed.rows.length - 8).toLocaleString()} more rows will be imported</div>}
                  </section>
                </div>
              )}
            </div>

            <footer className="bud-modal-actions odb-import-actions">
              {busy ? (
                <div className="odb-import-progress" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}>
                  <div><span>Importing rows…</span><strong>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()}</strong></div>
                  <span><i style={{ width: `${percent}%` }} /></span>
                </div>
              ) : (
                <div className="odb-import-footer-note">
                  {parsed ? <><IconInfoCircle size={13} /> Changes run in one transaction where supported.</> : "Select a file to continue."}
                </div>
              )}
              <MotionButton className="bud-modal-cancel" onClick={() => void requestClose()} disabled={busy}>Cancel</MotionButton>
              <MotionButton className="bud-modal-save" onClick={() => void run()} disabled={!canImport} title={readOnly ? "Disable read-only mode to import" : undefined}>
                {busy ? `Importing ${percent}%` : mode === "create" ? "Create and import" : "Append rows"}
              </MotionButton>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
      <input
        ref={fileRef}
        id="bud-import-csv-file"
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
          event.target.value = "";
        }}
      />
    </>
  );
}
