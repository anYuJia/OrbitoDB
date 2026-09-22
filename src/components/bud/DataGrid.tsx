import { IconAdjustmentsHorizontal, IconArrowUpRight, IconBookmarkPlus, IconCheck, IconChevronLeft, IconChevronRight, IconCopy, IconFilter, IconPlus, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { getBackend } from "../../ipc/backend";
import { displayRows } from "../../lib/cell";
import {
  normalizeHiddenColumns,
  readGridDensity,
  readHiddenColumns,
  writeGridDensity,
  writeHiddenColumns,
  type GridDensity,
} from "../../lib/gridPreferences";
import { TABLE_BROWSER_ROW_LIMIT } from "../../lib/sql";
import { promptDialog } from "../../state/dialog";
import { toast } from "../../state/toast";
import type { ColumnInfo } from "../../ipc/types";
import { useStore } from "../../state/store";
import { CellViewer, isExpandable } from "./CellViewer";
import { ColumnEditor, type ColumnEditorAnchor } from "./ColumnEditor";
import { ExportMenu } from "./ExportMenu";
import type { GridDisplayAnchor } from "./GridDisplayMenu";

const SavedViewDialog = lazy(() =>
  import("./SavedViewDialog").then((module) => ({ default: module.SavedViewDialog })),
);
const GridDisplayMenu = lazy(() =>
  import("./GridDisplayMenu").then((module) => ({ default: module.GridDisplayMenu })),
);

function localStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function typeIcon(t: string): string {
  const u = t.toUpperCase();
  if (/INT|SERIAL|NUM|DEC|REAL|FLOAT|DOUBLE|BIGINT/.test(u)) return "123";
  if (/DATE|TIME/.test(u)) return "◷";
  if (/BOOL/.test(u)) return "✓";
  return "T";
}

const PILL_COLORS: [string, string][] = [
  ["#36275f", "#c4b5fd"],
  ["#123a2c", "#6ee7b7"],
  ["#3a2a10", "#fcd34d"],
  ["#0f3040", "#7dd3fc"],
  ["#3a1230", "#f9a8d4"],
  ["#2a1240", "#d8b4fe"],
];

/**
 * Loading placeholder that mirrors the table it's about to show: the real
 * column headers are rendered (so nothing shifts when data arrives) and only
 * the cell bodies shimmer. If the structure isn't known yet there's nothing to
 * mirror — show a plain empty state instead of a generic skeleton.
 */
function GridSkeleton({ columns }: { columns?: ColumnInfo[] }) {
  // Structure not known yet — don't fake a grid, just say we're loading.
  if (!columns || columns.length === 0) {
    return <div className="bud-empty">Loading…</div>;
  }
  const rows = Array.from({ length: 8 });
  return (
    <div className="bud-grid-wrap">
      <table className="bud-grid bud-grid-skel">
        <thead>
          <tr>
            <th className="bud-checkcol" />
            <th className="bud-rownum" />
            {columns.map((c) => (
              <th key={c.name}>
                <span className="bud-th-ic">{typeIcon(c.dataType)}</span>
                <span className="bud-th-name">{c.name}</span>
              </th>
            ))}
            <th className="bud-addcol" />
          </tr>
        </thead>
        <tbody>
          {rows.map((_, r) => (
            <tr key={r}>
              <td className="bud-checkcol" />
              <td className="bud-rownum">{r + 1}</td>
              {columns.map((c, ci) => (
                <td key={c.name}>
                  <span className="sk sk-cell" style={{ width: `${45 + ((r * 7 + ci * 23) % 45)}%` }} />
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataGrid() {
  const rawResult = useStore((s) => s.result);
  // Defensively normalize cells for display (pg/mysql JSON -> objects, binary ->
  // Buffer). Idempotent with the data-layer pass in lib/cell, so already-clean
  // rows are returned as-is.
  const result = useMemo(
    () => (rawResult ? { ...rawResult, rows: displayRows(rawResult.rows) } : rawResult),
    [rawResult],
  );
  const editTable = useStore((s) => s.editTable);
  const loadingResult = useStore((s) => s.loadingResult);
  const editCell = useStore((s) => s.editCell);
  const addRow = useStore((s) => s.addRow);
  const addColumn = useStore((s) => s.addColumn);
  const openInspector = useStore((s) => s.openInspector);
  const inspectorRow = useStore((s) => s.inspectorRow);
  const selection = useStore((s) => s.selection);
  const toggleRow = useStore((s) => s.toggleRow);
  const setSelection = useStore((s) => s.setSelection);
  const clearSelection = useStore((s) => s.clearSelection);
  const duplicateSelected = useStore((s) => s.duplicateSelected);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const columns = useStore((s) => (editTable ? s.schema.columnsByTable[editTable.table] : undefined));
  const activeId = useStore((s) => s.activeConnectionId);
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));
  const navigateFk = useStore((s) => s.navigateFk);
  const pendingColFilter = useStore((s) => s.pendingColFilter);
  const setPendingColFilter = useStore((s) => s.setPendingColFilter);
  const openTableData = useStore((s) => s.openTableData);
  const openView = useStore((s) => s.openView);
  const searchTable = useStore((s) => s.searchTable);
  const activeViewId = useStore((s) => s.activeViewId);
  const views = useStore((s) => s.views);
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [newRow, setNewRow] = useState<string[] | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const cancelEditRef = useRef(false);
  const [colEditor, setColEditor] = useState<ColumnEditorAnchor | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [cellView, setCellView] = useState<{ value: string; column?: string } | null>(null);
  const [selCell, setSelCell] = useState<{ r: number; c: number } | null>(null);
  const [gridFilter, setGridFilter] = useState("");
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const serverSearched = useRef(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [density, setDensity] = useState<GridDensity>(() => readGridDensity(localStorageOrNull()));
  const [displayAnchor, setDisplayAnchor] = useState<GridDisplayAnchor | null>(null);
  const displayButtonRef = useRef<HTMLButtonElement>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const [columnPrefs, setColumnPrefs] = useState<{ id: string; hidden: string[] }>({ id: "", hidden: [] });
  const [allFks, setAllFks] = useState<{ table: string; column: string; refTable: string; refColumn: string }[]>([]);
  // Only show the skeleton if loading actually lingers — avoids a flash on the
  // near-instant in-browser SQLite loads.
  const [showSkel, setShowSkel] = useState(false);

  const pkCol = editTable?.pkColumn ?? null;
  const activeView = useMemo(
    () => views.find((savedView) => savedView.id === activeViewId) ?? null,
    [activeViewId, views],
  );
  const pkIdx = useMemo(
    () => (pkCol && result ? result.columns.findIndex((c) => c.name === pkCol) : -1),
    [pkCol, result],
  );
  const columnNames = useMemo(() => result?.columns.map((column) => column.name) ?? [], [result?.columns]);
  const columnSignature = columnNames.join("\u0000");
  const gridPreferenceId = activeId && editTable ? `${activeId}\u0000${editTable.table}` : "";
  const hiddenColumnNames = useMemo(
    () => columnPrefs.id === gridPreferenceId
      ? normalizeHiddenColumns(columnPrefs.hidden, columnNames)
      : [],
    [columnNames, columnPrefs, gridPreferenceId],
  );
  const hiddenColumnSet = useMemo(() => new Set(hiddenColumnNames), [hiddenColumnNames]);
  const visibleColumns = useMemo(
    () => (result?.columns ?? [])
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => !hiddenColumnSet.has(column.name)),
    [hiddenColumnSet, result?.columns],
  );

  // Columns rendered as colored option pills (few distinct short text values).
  const optionCols = useMemo(() => {
    const set = new Set<number>();
    if (!result) return set;
    const rows = result.rows;
    result.columns.forEach((c, i) => {
      if (/INT|NUM|REAL|FLOAT|DOUBLE|DATE|TIME/.test(c.dataType.toUpperCase())) return;
      const vals = new Set<string>();
      let ok = rows.length > 0;
      // Stop scanning as soon as a column can't be an option pill (long value or
      // too many distinct values) — avoids walking all rows of high-cardinality
      // text columns (ids, emails, JSON) on every table switch.
      for (let r = 0; r < rows.length; r++) {
        const v = rows[r][i] == null ? "" : String(rows[r][i]);
        if (v.length > 16) { ok = false; break; }
        vals.add(v);
        if (vals.size > 12) { ok = false; break; }
      }
      if (ok && vals.size > 0 && rows.length >= vals.size) set.add(i);
    });
    return set;
  }, [result]);

  // Display order of original row indices, honoring the active column sort.
  const order = useMemo(() => {
    const idx = result ? result.rows.map((_, i) => i) : [];
    if (!result || !sort) return idx;
    const { col, dir } = sort;
    return idx.sort((a, b) => {
      const x = result.rows[a][col];
      const y = result.rows[b][col];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const nx = Number(x);
      const ny = Number(y);
      const bothNum = x !== "" && y !== "" && !Number.isNaN(nx) && !Number.isNaN(ny);
      const cmp = bothNum ? nx - ny : String(x).localeCompare(String(y));
      return cmp * dir;
    });
  }, [result, sort]);

  useEffect(() => setSort(null), [editTable?.table, activeViewId]);

  // Column visibility belongs to a specific database table. Refresh the saved
  // preference only after the newly selected table has finished loading so a
  // briefly retained previous result cannot leak its columns into the new key.
  useEffect(() => {
    if (!activeId || !editTable || loadingResult || columnNames.length === 0) return;
    const id = `${activeId}\u0000${editTable.table}`;
    const hidden = readHiddenColumns(localStorageOrNull(), activeId, editTable.table, columnNames);
    setColumnPrefs((current) => (
      current.id === id && current.hidden.join("\u0000") === hidden.join("\u0000")
        ? current
        : { id, hidden }
    ));
  }, [activeId, columnSignature, editTable, loadingResult]);

  // Reset filters/paging when the table changes.
  useEffect(() => {
    setGridFilter("");
    setPage(0);
    serverSearched.current = false;
  }, [editTable?.table, activeViewId]);

  // Debounce search and run it on the server so matches beyond the loaded window
  // are found too. Saved views stay scoped to their database-side rule; clearing
  // search restores that view instead of silently switching back to all rows.
  useEffect(() => {
    if (!editTable) return;
    const q = gridFilter.trim();
    const id = setTimeout(() => {
      if (q) {
        serverSearched.current = true;
        void searchTable(q);
      } else if (serverSearched.current) {
        serverSearched.current = false;
        if (activeView) void openView(activeView);
        else void openTableData(editTable.table);
      }
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridFilter, editTable?.table, activeView?.id]);

  // Foreign keys are per-connection, so fetch them once (not on every table
  // switch) and derive the current table's map below.
  useEffect(() => {
    if (!activeId) {
      setAllFks([]);
      return;
    }
    let alive = true;
    getBackend()
      .listForeignKeys(activeId)
      .then((list) => alive && setAllFks(list))
      .catch(() => alive && setAllFks([]));
    return () => {
      alive = false;
    };
  }, [activeId]);

  const fks = useMemo(() => {
    const map: Record<string, { refTable: string; refColumn: string }> = {};
    if (editTable) {
      for (const fk of allFks) {
        if (fk.table === editTable.table) map[fk.column] = { refTable: fk.refTable, refColumn: fk.refColumn };
      }
    }
    return map;
  }, [allFks, editTable?.table]);

  // Seed the filter when arriving here by clicking a foreign key.
  useEffect(() => {
    if (!pendingColFilter) return;
    setGridFilter(pendingColFilter.value);
    setPage(0);
    setPendingColFilter(null);
  }, [pendingColFilter]);

  useEffect(() => {
    if (!loadingResult) {
      setShowSkel(false);
      return;
    }
    const t = setTimeout(() => setShowSkel(true), 160);
    return () => clearTimeout(t);
  }, [loadingResult]);

  // Ctrl/Cmd+C copies the selected cell (unless the user is typing or has a text selection).
  useEffect(() => {
    if (!selCell || !result) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "c" && e.key !== "C")) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (window.getSelection()?.toString()) return;
      const v = result.rows[selCell.r]?.[selCell.c];
      void navigator.clipboard?.writeText(v == null ? "" : String(v)).then(() => toast("Copied cell", "success")).catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selCell, result]);

  // The shortcut advertised in the add-row footer must be real. Ignore it
  // while the user is typing so the SQL editor and cell inputs keep ownership.
  useEffect(() => {
    if (!result || !editTable || readOnly || newRow) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      setNewRow(result.columns.map(() => ""));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editTable, newRow, readOnly, result]);

  const closeDisplayMenu = useCallback(() => {
    setDisplayAnchor(null);
    requestAnimationFrame(() => displayButtonRef.current?.focus());
  }, []);

  // While loading we keep the current grid on screen, so switching tables doesn't
  // flash to black (local queries finish well under the skeleton delay). Only show
  // a skeleton when there's genuinely nothing yet (the first load).
  if (loadingResult && !result) return showSkel ? <GridSkeleton columns={columns} /> : null;
  if (!result || !editTable) return null;
  const table = editTable.table;

  const q = gridFilter.trim().toLowerCase();
  const filteredOrder = q
    ? order.filter((ri) => result.rows[ri].some((c) => c != null && String(c).toLowerCase().includes(q)))
    : order;
  const hasFilters = !!q;
  const visibleSet = new Set(filteredOrder);
  const selectedVisible = selection.filter((index) => visibleSet.has(index)).length;
  const allVisibleSelected = filteredOrder.length > 0 && selectedVisible === filteredOrder.length;
  const someVisibleSelected = selectedVisible > 0 && !allVisibleSelected;
  const pageCount = Math.max(1, Math.ceil(filteredOrder.length / pageSize));
  const curPage = Math.min(page, pageCount - 1);
  const pagedOrder = filteredOrder.slice(curPage * pageSize, curPage * pageSize + pageSize);
  const validSelection = selection.filter((index) => index >= 0 && index < result.rows.length);
  const exportOrder = validSelection.length > 0 ? validSelection : filteredOrder;
  const densityStyle = (density === "compact" ? {
    "--bud-grid-header-height": "32px",
    "--bud-grid-row-height": "32px",
    "--bud-grid-cell-padding": "5px 9px",
  } : undefined) as CSSProperties | undefined;

  const colInfo = (name: string): ColumnInfo =>
    columns?.find((c) => c.name === name) ?? { name, dataType: "TEXT", nullable: true, isPrimaryKey: false };

  const toggleSort = (col: number) =>
    setSort((s) => (!s || s.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null));

  const changeHiddenColumns = (next: string[]) => {
    if (!activeId) return;
    const hidden = normalizeHiddenColumns(next, columnNames);
    setColumnPrefs({ id: gridPreferenceId, hidden });
    writeHiddenColumns(localStorageOrNull(), activeId, table, hidden);
    const hiddenSet = new Set(hidden);
    if (sort && hiddenSet.has(result.columns[sort.col]?.name)) setSort(null);
    if (selCell && hiddenSet.has(result.columns[selCell.c]?.name)) setSelCell(null);
    if (editing && hiddenSet.has(result.columns[editing.col]?.name)) setEditing(null);
  };

  const changeDensity = (next: GridDensity) => {
    setDensity(next);
    writeGridDensity(localStorageOrNull(), next);
  };

  const focusGridCell = (row: number, col: number) => {
    requestAnimationFrame(() => {
      const scroller = gridWrapRef.current;
      const cell = scroller?.querySelector<HTMLElement>(`[data-grid-cell="${row}:${col}"]`);
      if (!cell) return;
      cell.focus({ preventScroll: true });
      if (!scroller) return;
      if (col === visibleColumns[0]?.index) {
        scroller.scrollLeft = 0;
        return;
      }
      const leftEdge = scroller.scrollLeft + 76;
      const rightEdge = scroller.scrollLeft + scroller.clientWidth;
      if (cell.offsetLeft < leftEdge) scroller.scrollLeft = Math.max(0, cell.offsetLeft - 76);
      else if (cell.offsetLeft + cell.offsetWidth > rightEdge) {
        scroller.scrollLeft = cell.offsetLeft + cell.offsetWidth - scroller.clientWidth + 8;
      }
    });
  };

  const moveGridCell = (event: ReactKeyboardEvent<HTMLTableCellElement>, row: number, col: number) => {
    if (editing) return;
    const rowPosition = pagedOrder.indexOf(row);
    const columnPosition = visibleColumns.findIndex(({ index }) => index === col);
    if (rowPosition < 0 || columnPosition < 0) return;

    let nextRow = rowPosition;
    let nextColumn = columnPosition;
    if (event.key === "ArrowUp") nextRow = Math.max(0, rowPosition - 1);
    else if (event.key === "ArrowDown") nextRow = Math.min(pagedOrder.length - 1, rowPosition + 1);
    else if (event.key === "ArrowLeft") nextColumn = Math.max(0, columnPosition - 1);
    else if (event.key === "ArrowRight") nextColumn = Math.min(visibleColumns.length - 1, columnPosition + 1);
    else if (event.key === "Home") nextColumn = 0;
    else if (event.key === "End") nextColumn = visibleColumns.length - 1;
    else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      startEdit(row, col);
      return;
    } else return;

    event.preventDefault();
    const next = { r: pagedOrder[nextRow], c: visibleColumns[nextColumn].index };
    setSelCell(next);
    focusGridCell(next.r, next.c);
  };

  const startEdit = (row: number, col: number) => {
    if (!pkCol || col === pkIdx || readOnly) return;
    cancelEditRef.current = false;
    setEditing({ row, col });
    setDraft(result.rows[row][col] == null ? "" : String(result.rows[row][col]));
  };
  const commitEdit = () => {
    const cancelled = cancelEditRef.current;
    cancelEditRef.current = false;
    if (editing && !cancelled) void editCell(editing.row, editing.col, draft);
    setEditing(null);
  };
  const saveNewRow = async () => {
    if (!newRow || addingRow) return;
    const cols: string[] = [];
    const vals: unknown[] = [];
    result.columns.forEach((c, i) => {
      if (newRow[i] !== "") {
        cols.push(c.name);
        vals.push(newRow[i]);
      }
    });
    setAddingRow(true);
    const added = await addRow(cols, vals);
    setAddingRow(false);
    if (added) setNewRow(null);
  };
  const addColumnPrompt = async () => {
    const name = await promptDialog({ title: "New column", label: "Column name", placeholder: "e.g. created_at" });
    if (!name?.trim()) return;
    const dataType =
      (await promptDialog({ title: "Column type", label: "Type (TEXT, INTEGER, REAL, DATE, …)", defaultValue: "TEXT" }))?.trim() ||
      "TEXT";
    void addColumn(table, { name: name.trim(), dataType, nullable: true, primaryKey: false });
  };
  const pill = (v: unknown) => {
    const s = String(v);
    let h = 0;
    for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
    const [bg, fg] = PILL_COLORS[h % PILL_COLORS.length];
    return (
      <span className="bud-pill" style={{ background: bg, color: fg }}>
        {s}
      </span>
    );
  };

  return (
    <div className="bud-grid-area" style={{ ...densityStyle, position: "relative" }}>
      <div className="bud-grid-toolbar">
        <div className="bud-grid-search">
          <IconSearch size={13} stroke={2} />
          <input
            value={gridFilter}
            placeholder="Filter rows…"
            aria-label="Filter rows"
            onChange={(e) => {
              setGridFilter(e.target.value);
              setPage(0);
            }}
          />
          {gridFilter && (
            <button className="bud-grid-search-x" title="Clear filter" onClick={() => setGridFilter("")}>
              <IconX size={13} stroke={2} />
            </button>
          )}
        </div>
        {hasFilters && (
          <span className="bud-grid-toolbar-info">
            {filteredOrder.length.toLocaleString()} match{filteredOrder.length === 1 ? "" : "es"}
            {result.truncated ? " (first 1,000)" : ""}
          </span>
        )}
        {activeView && (
          <div className="bud-grid-active-view" role="status" aria-label={`Saved view ${activeView.name}`}>
            <IconFilter size={13} stroke={1.9} />
            <strong>{activeView.name}</strong>
            {activeView.filter && (
              <span>{activeView.filter.column} {activeView.filter.op} “{activeView.filter.value}”</span>
            )}
            <button
              title="Show all rows"
              aria-label={`Close saved view ${activeView.name} and show all rows`}
              onClick={() => void openTableData(table)}
            >
              <IconX size={12} stroke={2} />
            </button>
          </div>
        )}
        {validSelection.length > 0 && (
          <div className="bud-grid-selection" role="status" aria-label={`${validSelection.length} rows selected`}>
            <strong>{validSelection.length}</strong> selected
            <button title="Duplicate selected rows" onClick={() => void duplicateSelected()} disabled={readOnly}>
              <IconCopy size={13} stroke={1.8} /> Duplicate
            </button>
            <button className="danger" title="Delete selected rows" onClick={() => void deleteSelected()} disabled={readOnly}>
              <IconTrash size={13} stroke={1.8} /> Delete
            </button>
            <button className="icon" title="Clear selection" aria-label="Clear selection" onClick={clearSelection}>
              <IconX size={13} stroke={2} />
            </button>
          </div>
        )}
        <span className="bud-grid-foot-spacer" />
        <button
          ref={displayButtonRef}
          className="bud-grid-action"
          aria-haspopup="dialog"
          aria-expanded={displayAnchor != null}
          aria-label={`Display options, ${visibleColumns.length} of ${result.columns.length} columns shown`}
          onClick={(event) => {
            if (displayAnchor) {
              setDisplayAnchor(null);
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setDisplayAnchor({ bottom: rect.bottom, right: rect.right });
          }}
        >
          <IconAdjustmentsHorizontal size={14} stroke={1.8} />
          <span className="bud-grid-action-label">Display{hiddenColumnNames.length > 0 ? ` ${visibleColumns.length}/${result.columns.length}` : ""}</span>
        </button>
        <button className="bud-grid-action" aria-label="Save view" onClick={() => setViewDialogOpen(true)}>
          <IconBookmarkPlus size={14} stroke={1.8} /> <span className="bud-grid-action-label">Save view</span>
        </button>
        <ExportMenu result={result} rows={exportOrder.map((index) => result.rows[index])} table={table} />
      </div>
      <div ref={gridWrapRef} className="bud-grid-wrap">
        <table
          className="bud-grid"
          aria-label={`${table} data`}
          aria-rowcount={filteredOrder.length}
          aria-colcount={visibleColumns.length + 2}
        >
        <thead>
          <tr>
            <th className="bud-checkcol">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(node) => {
                  if (node) node.indeterminate = someVisibleSelected;
                }}
                onChange={(event) => {
                  if (event.target.checked) setSelection([...selection, ...filteredOrder]);
                  else setSelection(selection.filter((index) => !visibleSet.has(index)));
                }}
                aria-label={hasFilters ? "Select all matching rows" : "Select all rows"}
              />
            </th>
            <th className="bud-rownum" />
            {visibleColumns.map(({ column: c, index: i }) => (
              <th
                key={i}
                className={sort?.col === i ? "sorted" : ""}
                aria-sort={sort?.col === i ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
              >
                <button className="bud-th-sort" title={`Sort by ${c.name}`} onClick={() => toggleSort(i)}>
                  <span className="bud-th-ic">{typeIcon(c.dataType)}</span>
                  <span className="bud-th-name">{c.name}</span>
                  {sort?.col === i && <span className="bud-th-arrow">{sort.dir === 1 ? "↑" : "↓"}</span>}
                </button>
                <button
                  className="bud-th-menu"
                  title="Edit column"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setColEditor({ column: colInfo(c.name), x: r.left - 280, y: r.bottom });
                  }}
                >
                  ⋯
                </button>
              </th>
            ))}
            <th className="bud-addcol">
              <button className="bud-addcol-btn" title="Add column" onClick={addColumnPrompt} disabled={readOnly}>
                <IconPlus size={14} stroke={2} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {newRow && (
            <tr className="bud-newrow">
              <td className="bud-checkcol">
                <button className="bud-rowx" onClick={() => setNewRow(null)}>
                  <IconX size={13} stroke={2} />
                </button>
              </td>
              <td className="bud-rownum bud-newrow-num">
                <IconPlus size={13} stroke={2} />
              </td>
              {visibleColumns.map(({ column: c, index: i }, visibleIndex) => (
                <td key={i}>
                  <input
                    className="bud-cell-input"
                    placeholder={c.name}
                    value={newRow[i]}
                    autoFocus={visibleIndex === 0}
                    disabled={addingRow}
                    onChange={(e) => setNewRow((nr) => (nr ? nr.map((v, j) => (j === i ? e.target.value : v)) : nr))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveNewRow();
                      if (e.key === "Escape" && !addingRow) setNewRow(null);
                    }}
                  />
                </td>
              ))}
              <td className="bud-newrow-actions">
                <button title="Add row" aria-label="Add row" onClick={() => void saveNewRow()} disabled={addingRow}>
                  <IconCheck size={13} stroke={2} />
                </button>
                <button title="Cancel" aria-label="Cancel new row" onClick={() => setNewRow(null)} disabled={addingRow}>
                  <IconX size={13} stroke={2} />
                </button>
              </td>
            </tr>
          )}
          {pagedOrder.map((ri, pos) => {
            const row = result.rows[ri];
            return (
              <tr
                key={ri}
                className={`${ri === inspectorRow ? "row-open" : ""} ${selection.includes(ri) ? "selected" : ""}`}
              >
                <td className="bud-checkcol">
                  <input
                    type="checkbox"
                    className="bud-rowcheck"
                    checked={selection.includes(ri)}
                    onChange={() => toggleRow(ri)}
                    aria-label={`Select row ${curPage * pageSize + pos + 1}`}
                  />
                </td>
                <td className="bud-rownum">
                  <span className="rn-num">{curPage * pageSize + pos + 1}</span>
                  <button
                    className="rn-expand"
                    title="Edit row in panel"
                    aria-label={`Open row ${curPage * pageSize + pos + 1} details`}
                    onClick={() => void openInspector(ri)}
                  >
                    ⤢
                  </button>
                </td>
                {visibleColumns.map(({ index: ci }, visibleIndex) => {
                  const cell = row[ci];
                  const fk = cell != null ? fks[result.columns[ci].name] : undefined;
                  return (
                    <td
                      key={ci}
                      data-grid-cell={`${ri}:${ci}`}
                      tabIndex={selCell ? (selCell.r === ri && selCell.c === ci ? 0 : -1) : (pos === 0 && visibleIndex === 0 ? 0 : -1)}
                      className={`${cell == null ? "bud-null" : ""} ${fk ? "bud-fk-cell" : ""} ${selCell?.r === ri && selCell?.c === ci ? "sel" : ""}`}
                      title={cell == null ? "" : String(cell)}
                      aria-label={`${result.columns[ci].name}, row ${curPage * pageSize + pos + 1}: ${cell == null ? "NULL" : String(cell)}`}
                      onFocus={() => setSelCell({ r: ri, c: ci })}
                      onKeyDown={(event) => moveGridCell(event, ri, ci)}
                      onClick={(event) => {
                        event.currentTarget.focus();
                        setSelCell({ r: ri, c: ci });
                        const sv = cell == null ? "" : String(cell);
                        if (!editing && sv && isExpandable(sv)) setCellView({ value: sv, column: result.columns[ci].name });
                      }}
                      onDoubleClick={() => startEdit(ri, ci)}
                    >
                      {editing && editing.row === ri && editing.col === ci ? (
                        <input
                          className="bud-cell-input"
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEditRef.current = true;
                              e.currentTarget.blur();
                            }
                          }}
                        />
                      ) : cell == null ? (
                        <span className="bud-null-label">NULL</span>
                      ) : (
                        <>
                          {optionCols.has(ci) ? pill(cell) : String(cell)}
                          {fk && (
                            <button
                              className="bud-fk-jump"
                              title={`Go to ${fk.refTable}.${fk.refColumn} = ${String(cell)}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void navigateFk(fk.refTable, fk.refColumn, cell);
                              }}
                            >
                              <IconArrowUpRight size={12} stroke={2} />
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            );
          })}
          <tr className="bud-addrow">
            <td className="bud-checkcol">
              <button className="bud-addrow-btn" onClick={() => setNewRow(result.columns.map(() => ""))} title="Add row (⌘/Ctrl + Enter)" aria-label="Add row" disabled={readOnly}>
                <IconPlus size={15} stroke={2} />
              </button>
            </td>
            <td className="bud-rownum bud-kbd">
              <kbd>⌘</kbd>
              <kbd>↵</kbd>
            </td>
            <td colSpan={visibleColumns.length + 1} />
          </tr>
        </tbody>
      </table>
      </div>
      {filteredOrder.length === 0 && !newRow && (
          <div
            role="status"
            style={{
              position: "absolute",
              zIndex: 4,
              inset: "calc(44px + var(--bud-grid-header-height, 40px)) 0 0",
              display: "grid",
              placeItems: "center",
              padding: 16,
              background: "var(--bg)",
              color: "var(--faint)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {hasFilters ? (
              <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8 }}>
                No rows match “{gridFilter.trim()}”.
                <button className="bud-grid-action" onClick={() => setGridFilter("")}><IconX size={13} /> Clear filter</button>
              </span>
            ) : (
              <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8 }}>
                This table has no rows yet.
                {!readOnly && <button className="bud-grid-action" onClick={() => setNewRow(result.columns.map(() => ""))}><IconPlus size={13} /> Add first row</button>}
              </span>
            )}
          </div>
        )}
      {filteredOrder.length > 0 && (
        <div className="bud-grid-foot">
          <span className="bud-grid-foot-info">
            {hasFilters
              ? `${filteredOrder.length.toLocaleString()} of ${result.rows.length.toLocaleString()} rows`
              : `${result.rows.length.toLocaleString()} ${result.rows.length === 1 ? "row" : "rows"}`}
            {result.truncated ? ` (first ${TABLE_BROWSER_ROW_LIMIT.toLocaleString()})` : ""}
          </span>
          <span className="bud-grid-foot-spacer" />
          {pageCount > 1 && (
            <span className="bud-pager">
              <button title="Previous page" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>
                <IconChevronLeft size={14} stroke={2} />
              </button>
              <span className="bud-pager-info">
                {curPage + 1} / {pageCount}
              </span>
              <button title="Next page" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}>
                <IconChevronRight size={14} stroke={2} />
              </button>
            </span>
          )}
          <label className="bud-pagesize">
            Rows
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {[50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {colEditor && <ColumnEditor anchor={colEditor} table={table} onClose={() => setColEditor(null)} />}
      {cellView && <CellViewer value={cellView.value} column={cellView.column} onClose={() => setCellView(null)} />}
      {viewDialogOpen && (
        <Suspense fallback={null}>
          <SavedViewDialog
            table={table}
            columns={result.columns}
            initialFilter={activeView?.filter}
            onClose={() => setViewDialogOpen(false)}
          />
        </Suspense>
      )}
      {displayAnchor && (
        <Suspense fallback={null}>
          <GridDisplayMenu
            anchor={displayAnchor}
            columns={columnNames}
            hiddenColumns={hiddenColumnNames}
            density={density}
            onChangeHidden={changeHiddenColumns}
            onChangeDensity={changeDensity}
            onClose={closeDisplayMenu}
          />
        </Suspense>
      )}
    </div>
  );
}
