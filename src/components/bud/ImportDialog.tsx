import { IconFileImport, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { ColumnInfo } from "../../ipc/types";
import { detectDelimited, inferColumns } from "../../lib/csv";
import { useStore } from "../../state/store";

function defaultTargetNames(headers: string[]): string[] {
  const used = new Set<string>();
  return headers.map((header, index) => {
    const base = header.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || `col${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${suffix++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function ImportDialog({
  file,
  table,
  columns,
  readOnly,
  onClose,
}: {
  file: File;
  table: string;
  columns: ColumnInfo[];
  readOnly: boolean;
  onClose: () => void;
}) {
  const importCsv = useStore((s) => s.importCsv);
  const tables = useStore((s) => s.schema.tables);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [delimiter, setDelimiter] = useState<"," | "\t">(",");
  const [loading, setLoading] = useState(true);
  const [createNew, setCreateNew] = useState(false);
  const [newTable, setNewTable] = useState(() =>
    file.name.replace(/\.(csv|tsv|tab)$/i, "").replace(/[^A-Za-z0-9_]+/g, "_") || "imported_data",
  );
  const [mapping, setMapping] = useState<string[]>([]);
  const [newNames, setNewNames] = useState<string[]>([]);
  const [emptyAsNull, setEmptyAsNull] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void file
      .text()
      .then((text) => {
        if (!alive) return;
        const parsed = detectDelimited(text, file.name);
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        setDelimiter(parsed.delimiter);
        const targets = new Map(columns.map((column) => [column.name.toLowerCase(), column.name]));
        setMapping(parsed.headers.map((header) => targets.get(header.trim().toLowerCase()) ?? ""));
        setNewNames(defaultTargetNames(parsed.headers));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [file, columns]);

  const selected = useMemo(() => {
    const names = createNew ? newNames : mapping;
    return names
      .map((name, index) => ({ name: name.trim(), index }))
      .filter((item) => item.name);
  }, [createNew, mapping, newNames]);

  const duplicateTargets = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const item of selected) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) dup.add(item.name);
      seen.add(key);
    }
    return [...dup];
  }, [selected]);

  const targetExists = createNew && tables.some((item) => item.name.toLowerCase() === newTable.trim().toLowerCase());
  const inferred = useMemo(
    () => inferColumns(newNames, rows.map((row) => row.map((value) => value ?? ""))),
    [newNames, rows],
  );

  const canImport =
    !loading &&
    !busy &&
    !readOnly &&
    rows.length > 0 &&
    selected.length > 0 &&
    duplicateTargets.length === 0 &&
    (!createNew || (!!newTable.trim() && !targetExists));

  const runImport = async () => {
    if (!canImport) return;
    setBusy(true);
    try {
      const targetHeaders = selected.map((item) => item.name);
      const mappedRows = rows.map((row) =>
        selected.map((item) => {
          const value = row[item.index] ?? "";
          return emptyAsNull && value === "" ? null : value;
        }),
      );
      const ok = await importCsv(createNew ? newTable.trim() : table, targetHeaders, mappedRows, {
        create: createNew,
      });
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="odb-import-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="odb-import-dialog" role="dialog" aria-modal="true" aria-label="Import delimited data">
        <header>
          <div>
            <span className="odb-page-eyebrow">Data import</span>
            <h2>{file.name}</h2>
            <p>
              {rows.length.toLocaleString()} rows · {headers.length} columns · {delimiter === "\t" ? "TSV" : "CSV"}
            </p>
          </div>
          <button className="odb-icon-btn" onClick={onClose} title="Close">
            <IconX size={15} stroke={2} />
          </button>
        </header>

        {loading ? (
          <div className="odb-import-loading">Reading file…</div>
        ) : headers.length === 0 ? (
          <div className="odb-import-loading">No header row was found.</div>
        ) : (
          <>
            <div className="odb-import-options">
              <label>
                <input type="radio" checked={!createNew} onChange={() => setCreateNew(false)} />
                Import into <b>{table}</b>
              </label>
              <label>
                <input type="radio" checked={createNew} onChange={() => setCreateNew(true)} />
                Create a new table
              </label>
              {createNew && (
                <input
                  value={newTable}
                  onChange={(event) => setNewTable(event.target.value)}
                  placeholder="New table name"
                  aria-label="New table name"
                />
              )}
              <label className="odb-import-null">
                <input type="checkbox" checked={emptyAsNull} onChange={(event) => setEmptyAsNull(event.target.checked)} />
                Empty fields become NULL
              </label>
            </div>

            <div className="odb-import-mapping">
              <div className="odb-import-map-head">
                <span>Source column</span>
                <span>Target column</span>
                <span>Preview type</span>
              </div>
              {headers.map((header, index) => (
                <div className="odb-import-map-row" key={`${header}-${index}`}>
                  <code>{header || `Column ${index + 1}`}</code>
                  {createNew ? (
                    <input
                      value={newNames[index] ?? ""}
                      onChange={(event) =>
                        setNewNames((current) =>
                          current.map((value, i) => (i === index ? event.target.value : value)),
                        )
                      }
                      placeholder="blank = skip"
                    />
                  ) : (
                    <select
                      value={mapping[index] ?? ""}
                      onChange={(event) =>
                        setMapping((current) =>
                          current.map((value, i) => (i === index ? event.target.value : value)),
                        )
                      }
                    >
                      <option value="">Skip</option>
                      {columns.map((column) => (
                        <option key={column.name} value={column.name}>
                          {column.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <span>{inferred[index]?.dataType ?? "TEXT"}</span>
                </div>
              ))}
            </div>

            <div className="odb-import-preview">
              <div className="odb-import-preview-head">
                <b>Preview</b>
                <span>First {Math.min(rows.length, 20)} rows</span>
              </div>
              <div>
                <table>
                  <thead>
                    <tr>{headers.map((header, index) => <th key={index}>{header || `Column ${index + 1}`}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 20).map((row, ri) => (
                      <tr key={ri}>
                        {headers.map((_, ci) => <td key={ci}>{row[ci] ?? ""}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <footer>
              <div className="odb-import-status">
                {readOnly
                  ? "Read-only mode blocks imports."
                  : duplicateTargets.length
                    ? `Duplicate target columns: ${duplicateTargets.join(", ")}`
                    : targetExists
                      ? "A table with that name already exists."
                      : `${selected.length} mapped columns · ${rows.length.toLocaleString()} rows`}
              </div>
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!canImport} onClick={() => void runImport()}>
                <IconFileImport size={14} stroke={2} />
                {busy ? "Importing…" : createNew ? "Create & import" : "Import"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
