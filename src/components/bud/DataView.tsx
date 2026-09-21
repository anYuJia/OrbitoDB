import {
  IconBolt,
  IconClock,
  IconCode,
  IconCopy,
  IconDatabase,
  IconDownload,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconStar,
  IconTable,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { type ComponentType, type MouseEvent, useEffect, useRef, useState } from "react";
import { download, fromCsv, toCsv } from "../../lib/csv";
import { viewV } from "../../lib/motion";
import { toast } from "../../state/toast";
import { useStore } from "../../state/store";
import { DataGrid } from "./DataGrid";
import { RowInspector } from "./RowInspector";
import { SqlPanel } from "./SqlPanel";

type Icon = ComponentType<{ size?: number; stroke?: number }>;
const TOOLS: { Icon: Icon; label: string }[] = [
  { Icon: IconDownload, label: "Import" },
  { Icon: IconUpload, label: "Export" },
  { Icon: IconBolt, label: "Row actions" },
];

type MenuState = { kind: "rowactions" | "generate"; x: number; y: number } | null;

export function DataView({ onAddServer }: { onAddServer: () => void }) {
  const editTable = useStore((s) => s.editTable);
  const activeId = useStore((s) => s.activeConnectionId);
  const inspectorRow = useStore((s) => s.inspectorRow);
  const result = useStore((s) => s.result);
  const error = useStore((s) => s.error);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openTables = useStore((s) => s.openTables);
  const openTableData = useStore((s) => s.openTableData);
  const closeTableTab = useStore((s) => s.closeTableTab);
  const setSql = useStore((s) => s.setSql);
  const setTopView = useStore((s) => s.setTopView);
  const importCsv = useStore((s) => s.importCsv);
  const selection = useStore((s) => s.selection);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const duplicateSelected = useStore((s) => s.duplicateSelected);
  const clearSelection = useStore((s) => s.clearSelection);
  const editors = useStore((s) => s.editors);
  const activeEditorId = useStore((s) => s.activeEditorId);
  const selectEditor = useStore((s) => s.selectEditor);
  const closeEditor = useStore((s) => s.closeEditor);
  const newEditor = useStore((s) => s.newEditor);
  const [menu, setMenu] = useState<MenuState>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const table = editTable?.table ?? "export";
  const n = selection.length;

  const openMenu = (kind: "rowactions" | "generate", e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu((m) => (m?.kind === kind ? null : { kind, x: r.left, y: r.bottom + 4 }));
  };

  const exportSelected = () => {
    if (!result) return;
    const rows = n ? selection.map((i) => result.rows[i]) : result.rows;
    download(`${table}${n ? "-selected" : ""}.csv`, toCsv({ ...result, rows }));
    setMenu(null);
  };

  const generate = (sql: string) => {
    setSql(sql);
    setView("sql");
    setMenu(null);
  };

  const onTool = (label: string, e: MouseEvent) => {
    switch (label) {
      case "Import":
        fileRef.current?.click();
        break;
      case "Export":
        if (result) download(`${table}.csv`, toCsv(result));
        break;
      case "Row actions":
        openMenu("rowactions", e);
        break;
      case "Generate":
        openMenu("generate", e);
        break;
      case "Screens":
        setTopView("design");
        break;
      case "Automations":
        setTopView("automation");
        break;
      default:
        break;
    }
  };

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows } = fromCsv(String(reader.result));
      if (editTable && headers.length) void importCsv(editTable.table, headers, rows);
    };
    reader.readAsText(file);
  };

  const cols = result?.columns.map((c) => c.name) ?? [];

  const moveTabFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || tabs.length === 0) return;
    e.preventDefault();
    const next = e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (current + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  };

  return (
    <motion.main className="bud-main" variants={viewV} initial="hidden" animate="show" exit="exit">
      <div className="bud-qtabs" role="tablist" aria-label="Open workspace tabs" onKeyDown={moveTabFocus}>
        {editors.map((ed) => (
          <div
            key={ed.id}
            className={`bud-qtab ${view === "sql" && activeEditorId === ed.id ? "on" : ""}`}
          >
            <button
              className="bud-qtab-main"
              role="tab"
              aria-selected={view === "sql" && activeEditorId === ed.id}
              tabIndex={view === "sql" && activeEditorId === ed.id ? 0 : -1}
              title={ed.name}
              onClick={() => selectEditor(ed.id)}
            >
              <IconCode size={14} stroke={1.7} className="bud-qtab-ic sql" />
              <span>{ed.name}</span>
            </button>
            <button
              type="button"
              className="bud-qtab-x"
              aria-label={`Close ${ed.name}`}
              onClick={(e) => {
                e.stopPropagation();
                closeEditor(ed.id);
              }}
            >
              <IconX size={12} stroke={2} />
            </button>
          </div>
        ))}
        <button className="bud-qtab-new" aria-label="New SQL editor" title="New SQL editor" onClick={newEditor}>
          <IconPlus size={15} stroke={2} />
        </button>
        {openTables.map((t) => (
          <div
            key={t}
            className={`bud-qtab ${view === "data" && editTable?.table === t ? "on" : ""}`}
          >
            <button
              className="bud-qtab-main"
              role="tab"
              aria-selected={view === "data" && editTable?.table === t}
              tabIndex={view === "data" && editTable?.table === t ? 0 : -1}
              title={t}
              onClick={() => {
                if (editTable?.table === t) setView("data");
                else void openTableData(t);
              }}
            >
              <IconTable size={14} stroke={1.7} className="bud-qtab-ic" />
              <span>{t}</span>
            </button>
            <button
              type="button"
              className="bud-qtab-x"
              aria-label={`Close ${t}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTableTab(t);
              }}
            >
              <IconX size={12} stroke={2} />
            </button>
          </div>
        ))}
        {view === "history" && (
          <div className="bud-qtab on">
            <button className="bud-qtab-main" role="tab" aria-selected="true" onClick={() => setView("history")}>
              <IconClock size={14} stroke={1.7} className="bud-qtab-ic" />
              <span>SQL History</span>
            </button>
            <button type="button" className="bud-qtab-x" aria-label="Close SQL History" onClick={() => setView("sql")}>
              <IconX size={12} stroke={2} />
            </button>
          </div>
        )}
      </div>

      <div className="bud-toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.label}
            className={`bud-tool ${t.label === "Row actions" && n ? "has-sel" : ""}`}
            onClick={(e) => onTool(t.label, e)}
          >
            <t.Icon size={15} stroke={1.6} /> {t.label}
            {t.label === "Row actions" && n > 0 && <span className="bud-sel-badge">{n}</span>}
          </button>
        ))}
      </div>

      {error && <div className="bud-error">⚠ {error.message ?? error.kind}</div>}

      {!activeId ? (
        <div className="bud-welcome">
          <div className="bud-welcome-glow" aria-hidden />
          <div className="bud-welcome-mark">
            <img src="/orbitodb-logo.svg" alt="" />
          </div>
          <span className="bud-welcome-kicker">LOCAL-FIRST DATABASE WORKSPACE</span>
          <h1>Bring your data into focus.</h1>
          <p>Explore schemas, edit records, and run SQL across SQLite, PostgreSQL, and MySQL from one calm workspace.</p>
          <div className="bud-welcome-actions">
            <button className="primary" onClick={onAddServer}>
              <IconDatabase size={17} stroke={1.8} /> Add data source
            </button>
            <button onClick={() => window.dispatchEvent(new Event("orbitodb:cmdk"))}>
              <IconSearch size={17} stroke={1.8} /> Explore commands <kbd>⌘K</kbd>
            </button>
          </div>
          <div className="bud-welcome-features">
            <span><IconCode size={15} stroke={1.7} /> Fast SQL workflow</span>
            <span><IconBolt size={15} stroke={1.7} /> Direct data editing</span>
            <span><IconTable size={15} stroke={1.7} /> Schema-aware tools</span>
          </div>
        </div>
      ) : view === "history" ? (
        <HistoryView />
      ) : view === "sql" ? (
        <SqlPanel key={activeEditorId} />
      ) : !editTable ? (
        <div className="bud-context-empty">
          <span className="bud-context-empty-icon"><IconTable size={22} stroke={1.55} /></span>
          <strong>Select a table</strong>
          <span>Choose a table from the sidebar to browse and edit its rows.</span>
        </div>
      ) : (
        <div className="bud-data-row">
          <DataGrid />
          <RowInspector key={inspectorRow ?? "none"} />
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportFile(f);
          e.target.value = "";
        }}
      />

      {menu && (
        <>
          <div className="bud-menu-backdrop" onClick={() => setMenu(null)} />
          <div className="bud-menu" style={{ position: "fixed", left: menu.x, top: menu.y }}>
            {menu.kind === "rowactions" ? (
              <>
                <button disabled={!n} onClick={() => void duplicateSelected().then(() => setMenu(null))}>
                  <IconCopy size={15} stroke={1.7} /> Duplicate {n || "selected"}
                </button>
                <button onClick={exportSelected}>
                  <IconDownload size={15} stroke={1.7} /> Export {n ? `${n} selected` : "all"} to CSV
                </button>
                <button className="danger" disabled={!n} onClick={() => void deleteSelected().then(() => setMenu(null))}>
                  <IconTrash size={15} stroke={1.7} /> Delete {n || "selected"}
                </button>
                {n > 0 && (
                  <button onClick={() => { clearSelection(); setMenu(null); }}>
                    <IconX size={15} stroke={1.7} /> Clear selection
                  </button>
                )}
              </>
            ) : (
              <>
                <button onClick={() => generate(`SELECT * FROM ${table} LIMIT 100;`)}>
                  <IconCode size={15} stroke={1.7} /> SELECT all rows
                </button>
                <button onClick={() => generate(`SELECT count(*) FROM ${table};`)}>
                  <IconCode size={15} stroke={1.7} /> Count rows
                </button>
                <button
                  onClick={() =>
                    generate(`INSERT INTO ${table} (${cols.join(", ")})\nVALUES (${cols.map(() => "?").join(", ")});`)
                  }
                >
                  <IconCode size={15} stroke={1.7} /> INSERT template
                </button>
              </>
            )}
          </div>
        </>
      )}

    </motion.main>
  );
}

/** SQL history: every executed statement, newest first, click to reload. */
function HistoryView() {
  const history = useStore((s) => s.history);
  const loadHistory = useStore((s) => s.loadHistory);
  const loadSql = useStore((s) => s.loadSql);
  const run = useStore((s) => s.run);
  const saveFavorite = useStore((s) => s.saveFavorite);
  const favorites = useStore((s) => s.favorites);
  const [q, setQ] = useState("");

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const ql = q.trim().toLowerCase();
  const shown = ql ? history.filter((h) => h.sql.toLowerCase().includes(ql)) : history;
  const favSqls = new Set(favorites.map((f) => norm(f.sql)));

  const rerun = (sql: string) => {
    loadSql(sql);
    void run();
  };
  const star = (sql: string) => {
    saveFavorite(norm(sql).slice(0, 48), sql);
    toast("Added to favorites", "success");
  };

  return (
    <div className="bud-history">
      <div className="bud-hist-bar">
        <IconSearch size={13} stroke={1.7} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search history…" />
        {q && (
          <button className="bud-hist-bar-x" title="Clear" onClick={() => setQ("")}>
            <IconX size={13} stroke={1.9} />
          </button>
        )}
        <span className="bud-hist-count">{shown.length}</span>
      </div>
      {shown.length === 0 ? (
        <div className="bud-empty">{history.length === 0 ? "No SQL has been run yet." : "No matching history."}</div>
      ) : (
        shown.map((h) => {
          const fav = favSqls.has(norm(h.sql));
          return (
            <div key={h.id} className="bud-hist-item">
              <button className="bud-hist-main" title="Load into editor" onClick={() => loadSql(h.sql)}>
                <span className="bud-hist-sql">{norm(h.sql)}</span>
                <span className="bud-hist-time">{new Date(h.ranAt).toLocaleString()}</span>
              </button>
              <span className="bud-hist-actions">
                <button title="Re-run" onClick={() => rerun(h.sql)}>
                  <IconPlayerPlay size={13} stroke={1.8} />
                </button>
                <button className={fav ? "on" : ""} title={fav ? "In favorites" : "Add to favorites"} onClick={() => star(h.sql)}>
                  <IconStar size={13} stroke={1.8} />
                </button>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
