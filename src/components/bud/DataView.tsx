import {
  IconArrowRight,
  IconBolt,
  IconClock,
  IconCode,
  IconDatabase,
  IconHome,
  IconLock,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStar,
  IconTable,
  IconX,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { lazy, Suspense, useEffect, useState } from "react";
import { viewV } from "../../lib/motion";
import { confirmDialog } from "../../state/dialog";
import { toast } from "../../state/toast";
import { useStore } from "../../state/store";
import { DataGrid } from "./DataGrid";

const ConnectionOverview = lazy(() =>
  import("./ConnectionOverview").then((module) => ({ default: module.ConnectionOverview })),
);
const SqlPanel = lazy(() => import("./SqlPanel").then((module) => ({ default: module.SqlPanel })));
const QueryTabActions = lazy(() =>
  import("./QueryTabActions").then((module) => ({ default: module.QueryTabActions })),
);
const RowInspector = lazy(() =>
  import("./RowInspector").then((module) => ({ default: module.RowInspector })),
);

function WorkspaceFallback({ label }: { label: string }) {
  return (
    <div className="bud-workspace-fallback" role="status" aria-label={label}>
      <span className="bud-loading-spinner" />
      <span>{label}</span>
    </div>
  );
}

function queryTabLabel(editor: { name: string; sql: string }): string {
  const clean = editor.sql
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return editor.name;
  const verb = clean.match(/^([a-z]+)/i)?.[1]?.toUpperCase();
  const relation = clean.match(/\b(?:from|into|update|table)\s+([`"\[\]\w.]+)/i)?.[1]
    ?.replace(/[`"\[\]]/g, "");
  if (verb && relation) return `${verb} · ${relation}`;
  return clean.length > 28 ? `${clean.slice(0, 27)}…` : clean;
}

export function DataView({ onAddServer }: { onAddServer: () => void }) {
  const editTable = useStore((s) => s.editTable);
  const connections = useStore((s) => s.connections);
  const activeId = useStore((s) => s.activeConnectionId);
  const activeConnection = useStore((s) => s.connections.find((connection) => connection.id === s.activeConnectionId));
  const inspectorRow = useStore((s) => s.inspectorRow);
  const error = useStore((s) => s.error);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openTables = useStore((s) => s.openTables);
  const openTableData = useStore((s) => s.openTableData);
  const closeTableTab = useStore((s) => s.closeTableTab);
  const editors = useStore((s) => s.editors);
  const activeEditorId = useStore((s) => s.activeEditorId);
  const selectEditor = useStore((s) => s.selectEditor);
  const closeEditors = useStore((s) => s.closeEditors);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const reload = useStore((s) => s.reload);
  const tableResult = useStore((s) => s.result);
  const tableColumns = useStore((s) => editTable ? s.schema.columnsByTable[editTable.table] : undefined);
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));
  const requestCloseEditors = async (ids: string[], title: string, actionLabel: string) => {
    if (!ids.length) return;
    const closing = editors.filter((editor) => ids.includes(editor.id));
    const withContent = closing.filter((editor) => editor.sql.trim());
    if (
      withContent.length > 0 &&
      !(await confirmDialog({
        title,
        message: `${withContent.length} ${withContent.length === 1 ? "query contains" : "queries contain"} SQL. Closing ${withContent.length === 1 ? "it" : "them"} removes the restored workspace copy.`,
        confirmLabel: actionLabel,
        danger: true,
      }))
    ) return;
    closeEditors(ids);
  };

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
      <div className="odb-tabbar">
        <div className="bud-qtabs" role="tablist" aria-label="Open workspace tabs" onKeyDown={moveTabFocus}>
        {activeId && (
          <button
            className={`odb-start-tab ${view === "overview" ? "on" : ""}`}
            role="tab"
            aria-label="Start center"
            aria-selected={view === "overview"}
            tabIndex={view === "overview" ? 0 : -1}
            title="Start center"
            onClick={() => setView("overview")}
          >
            <IconHome size={15} stroke={1.75} />
          </button>
        )}
        {editors.map((ed) => {
          const label = queryTabLabel(ed);
          return (
            <div
              key={ed.id}
              className={`bud-qtab ${view === "sql" && activeEditorId === ed.id ? "on" : ""}`}
            >
            <button
              className="bud-qtab-main"
              role="tab"
              aria-selected={view === "sql" && activeEditorId === ed.id}
              tabIndex={view === "sql" && activeEditorId === ed.id ? 0 : -1}
              title={ed.sql.trim() || ed.name}
              onClick={() => selectEditor(ed.id)}
            >
              <IconCode size={14} stroke={1.7} className="bud-qtab-ic sql" />
              <span>{label}</span>
            </button>
            <button
              type="button"
              className="bud-qtab-x"
              aria-label={`Close ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                void requestCloseEditors([ed.id], "Close query tab?", "Close tab");
              }}
            >
              <IconX size={12} stroke={2} />
            </button>
          </div>
          );
        })}
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
        <Suspense fallback={<div className="odb-tabbar-actions-loading" aria-hidden />}>
          <QueryTabActions />
        </Suspense>
      </div>

      {error && <div className="bud-error">⚠ {error.message ?? error.kind}</div>}

      {!activeId ? (
        <div className="odb-empty-start">
          <section className="odb-empty-start-main">
            <div className="odb-empty-start-mark"><img src="/orbitodb-logo.svg" alt="" /></div>
            <p className="odb-eyebrow">ORBITODB WORKSPACE</p>
            <h1>Open a database to begin</h1>
            <p className="odb-empty-start-copy">Browse data, edit records, and run SQL without leaving your local workspace.</p>
            <div className="odb-empty-start-actions">
              <button className="primary" onClick={onAddServer}>
                <IconDatabase size={17} stroke={1.8} /> Connect database
              </button>
              <button onClick={() => window.dispatchEvent(new Event("orbitodb:cmdk"))}>
                <IconSearch size={16} stroke={1.8} /> Open command menu <kbd>⌘K</kbd>
              </button>
            </div>
          </section>

          <aside className="odb-recent-connections" aria-label="Saved connections">
            <div className="odb-section-heading">
              <div><span>Saved connections</span><small>{connections.length} available</small></div>
              <button onClick={onAddServer}><IconPlus size={14} /> Add</button>
            </div>
            {connections.length === 0 ? (
              <div className="odb-inline-empty">Your saved databases will appear here.</div>
            ) : connections.slice(0, 6).map((connection) => (
              <button key={connection.id} className="odb-connection-row" onClick={() => void openAndIntrospect(connection.id)}>
                <span className="odb-resource-icon"><IconDatabase size={15} stroke={1.7} /></span>
                <span><strong>{connection.name}</strong><small>{connection.engine} · {connection.database}</small></span>
                {connection.env && <em className={`odb-env ${connection.env}`}>{connection.env}</em>}
                <IconArrowRight size={14} />
              </button>
            ))}
          </aside>

          <div className="odb-empty-start-hints">
            <span><IconCode size={15} stroke={1.7} /> SQL autocomplete and history</span>
            <span><IconBolt size={15} stroke={1.7} /> Direct, guarded data editing</span>
            <span><IconTable size={15} stroke={1.7} /> SQLite, PostgreSQL, and MySQL</span>
          </div>
        </div>
      ) : view === "overview" ? (
        <Suspense fallback={<WorkspaceFallback label="Loading overview" />}>
          <ConnectionOverview />
        </Suspense>
      ) : view === "history" ? (
        <HistoryView />
      ) : view === "sql" ? (
        <Suspense fallback={<WorkspaceFallback label="Loading query editor" />}>
          <SqlPanel key={activeEditorId} />
        </Suspense>
      ) : !editTable ? (
        <div className="bud-context-empty">
          <span className="bud-context-empty-icon"><IconTable size={22} stroke={1.55} /></span>
          <strong>Select a table</strong>
          <span>Choose a table from the sidebar to browse and edit its rows.</span>
        </div>
      ) : (
        <div className="odb-table-workspace">
          <header className="odb-document-header">
            <div className="odb-document-title">
              <span className="odb-document-breadcrumb">{activeConnection?.name} / Tables</span>
              <div>
                <IconTable size={18} stroke={1.7} />
                <h1>{editTable.table}</h1>
                {readOnly && <span className="odb-readonly"><IconLock size={12} /> Read-only</span>}
              </div>
            </div>
            <div className="odb-document-meta">
              <span>{tableResult?.rows.length.toLocaleString() ?? "—"} loaded rows</span>
              <span>{tableColumns?.length.toLocaleString() ?? "—"} columns</span>
              {editTable.pkColumn && <span>Primary key: {editTable.pkColumn}</span>}
            </div>
            <button className="odb-icon-action" title="Refresh table" aria-label="Refresh table" onClick={() => void reload(editTable.table)}>
              <IconRefresh size={16} stroke={1.8} />
            </button>
          </header>
          <div className="bud-data-row">
            <DataGrid />
            {inspectorRow != null && (
              <Suspense fallback={null}>
                <RowInspector key={inspectorRow} />
              </Suspense>
            )}
          </div>
        </div>
      )}

    </motion.main>
  );
}

/** SQL history: every executed statement, newest first, click to reload. */
function HistoryView() {
  const history = useStore((s) => s.history);
  const activeId = useStore((s) => s.activeConnectionId);
  const connectionName = useStore((s) => s.connections.find((connection) => connection.id === s.activeConnectionId)?.name);
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
  const connectionHistory = history.filter((entry) => entry.connectionId === activeId);
  const shown = ql ? connectionHistory.filter((h) => h.sql.toLowerCase().includes(ql)) : connectionHistory;
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
      <header className="odb-history-header">
        <div>
          <span className="odb-document-breadcrumb">{connectionName ?? "Workspace"}</span>
          <h1>Query history</h1>
          <p>Review, reuse, and save statements executed on this connection.</p>
        </div>
        <div className="bud-hist-bar">
          <IconSearch size={14} stroke={1.7} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${connectionName ?? "connection"} history…`} />
          {q && (
            <button className="bud-hist-bar-x" title="Clear" onClick={() => setQ("")}>
              <IconX size={13} stroke={1.9} />
            </button>
          )}
          <span className="bud-hist-count">{shown.length}</span>
        </div>
      </header>
      <div className="odb-history-columns" aria-hidden>
        <span>Statement</span><span>Executed</span><span>Actions</span>
      </div>
      {shown.length === 0 ? (
        <div className="bud-empty">{connectionHistory.length === 0 ? `No SQL has been run on ${connectionName ?? "this connection"}.` : "No matching history."}</div>
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
