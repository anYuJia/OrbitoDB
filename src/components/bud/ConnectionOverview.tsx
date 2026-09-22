import {
  IconArrowRight,
  IconBolt,
  IconClock,
  IconCode,
  IconDatabase,
  IconEye,
  IconFileImport,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSchema,
  IconSearch,
  IconTable,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { TableInfo } from "../../ipc/types";
import { useStore } from "../../state/store";
import "./connection-overview.css";

function engineName(engine: string): string {
  if (engine === "postgres") return "PostgreSQL";
  if (engine === "mysql") return "MySQL";
  return "SQLite";
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(value).toLocaleDateString();
}

export function ConnectionOverview() {
  const connection = useStore((state) =>
    state.connections.find((item) => item.id === state.activeConnectionId),
  );
  const tables = useStore((state) => state.schema.tables);
  const columnsByTable = useStore((state) => state.schema.columnsByTable);
  const history = useStore((state) => state.history);
  const savedViews = useStore((state) => state.views);
  const loading = useStore((state) => state.loadingTables);
  const readOnly = useStore((state) =>
    state.readOnlyConns.includes(state.activeConnectionId ?? ""),
  );
  const newEditor = useStore((state) => state.newEditor);
  const openTableData = useStore((state) => state.openTableData);
  const refreshSchema = useStore((state) => state.refreshSchema);
  const loadHistory = useStore((state) => state.loadHistory);
  const loadSql = useStore((state) => state.loadSql);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const connectionTables = useMemo(
    () => tables.filter((item) => item.kind.toLowerCase() !== "view"),
    [tables],
  );
  const databaseViews = useMemo(
    () => tables.filter((item) => item.kind.toLowerCase() === "view"),
    [tables],
  );
  const shownTables = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return tables;
    return tables.filter((item) => item.name.toLocaleLowerCase().includes(query));
  }, [filter, tables]);
  const recent = useMemo(
    () => history.filter((item) => item.connectionId === connection?.id).slice(0, 5),
    [connection?.id, history],
  );
  const schemaNames = new Set(tables.map((item) => item.name));
  const viewCount = savedViews.filter(
    (item) => item.connectionId === connection?.id && schemaNames.has(item.table),
  ).length;
  const knownColumns = Object.values(columnsByTable).reduce((sum, columns) => sum + columns.length, 0);

  if (!connection) return null;

  const openResource = (item: TableInfo) => void openTableData(item.name);

  return (
    <div className="bud-overview">
      <header className="bud-overview-hero">
        <div className="bud-overview-copy">
          <div className="bud-overview-kicker">
            <span className="bud-live-dot" /> Connected workspace
            <span className="bud-overview-engine">{engineName(connection.engine)}</span>
          </div>
          <h1>{connection.name}</h1>
          <p>
            {connection.engine === "sqlite"
              ? connection.database
              : `${connection.host ?? "localhost"}${connection.port ? `:${connection.port}` : ""} / ${connection.database}`}
          </p>
          <div className="bud-overview-badges">
            {connection.env && <span className={`bud-overview-badge ${connection.env}`}>{connection.env}</span>}
            {readOnly && <span className="bud-overview-badge readonly"><IconLock size={12} /> Read-only</span>}
          </div>
        </div>
        <div className="bud-overview-actions">
          <button className="secondary" onClick={() => void refreshSchema()} disabled={loading}>
            <IconRefresh size={16} className={loading ? "spin" : ""} />
            {loading ? "Refreshing…" : "Refresh schema"}
          </button>
          <button className="primary" onClick={newEditor}>
            <IconCode size={17} /> New query
          </button>
        </div>
      </header>

      <section className="bud-overview-metrics" aria-label="Database summary">
        <div>
          <span>Tables</span>
          <strong>{connectionTables.length.toLocaleString()}</strong>
          <small>Browsable resources</small>
        </div>
        <div>
          <span>Database views</span>
          <strong>{databaseViews.length.toLocaleString()}</strong>
          <small>Defined in schema</small>
        </div>
        <div>
          <span>Known columns</span>
          <strong>{knownColumns.toLocaleString()}</strong>
          <small>{knownColumns ? "Schema indexed" : tables.length ? "Indexing schema" : "No columns found"}</small>
        </div>
        <div>
          <span>Saved views</span>
          <strong>{viewCount.toLocaleString()}</strong>
          <small>Reusable filters</small>
        </div>
      </section>

      <div className="bud-overview-layout">
        <section className="bud-overview-panel bud-overview-schema">
          <div className="bud-overview-panel-head">
            <div>
              <span className="bud-section-icon"><IconDatabase size={16} /></span>
              <div>
                <h2>Schema</h2>
                <p>{tables.length.toLocaleString()} resources available</p>
              </div>
            </div>
            <label className="bud-overview-search">
              <IconSearch size={14} />
              <input
                aria-label="Filter schema resources"
                placeholder="Filter schema…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
          </div>

          <div className="bud-overview-resource-head" aria-hidden>
            <span>Resource</span>
            <span>Type</span>
            <span>Columns</span>
            <span />
          </div>
          <div className="bud-overview-resources">
            {loading ? (
              Array.from({ length: 6 }, (_, index) => <div className="bud-resource-skeleton" key={index} />)
            ) : shownTables.length === 0 && filter.trim() ? (
              <div className="bud-overview-empty">
                <IconSearch size={20} />
                <strong>No matching resources</strong>
                <span>Try a different table or view name.</span>
              </div>
            ) : shownTables.length === 0 ? (
              <div className="bud-overview-empty">
                <IconDatabase size={20} />
                <strong>This database is empty</strong>
                <span>Import a CSV or create a table from the sidebar to begin.</span>
                <button onClick={() => window.dispatchEvent(new Event("orbitodb:import-csv"))}>
                  <IconPlus size={14} /> Import CSV
                </button>
              </div>
            ) : (
              shownTables.slice(0, 12).map((item) => {
                const isView = item.kind.toLowerCase() === "view";
                const columnCount = columnsByTable[item.name]?.length;
                return (
                  <button key={`${item.kind}-${item.name}`} className="bud-resource-row" onClick={() => openResource(item)}>
                    <span className={`bud-resource-icon ${isView ? "view" : "table"}`}>
                      {isView ? <IconEye size={15} /> : <IconTable size={15} />}
                    </span>
                    <span className="bud-resource-name">{item.name}</span>
                    <span className="bud-resource-kind">{isView ? "View" : "Table"}</span>
                    <span className="bud-resource-columns">{columnCount ?? "—"}</span>
                    <IconArrowRight size={14} className="bud-resource-arrow" />
                  </button>
                );
              })
            )}
          </div>
          {shownTables.length > 12 && (
            <div className="bud-overview-panel-foot">
              Showing 12 of {shownTables.length.toLocaleString()} resources. Use the sidebar for the full schema.
            </div>
          )}
        </section>

        <aside className="bud-overview-aside">
          <section className="bud-overview-panel">
            <div className="bud-overview-panel-head compact">
              <div>
                <span className="bud-section-icon"><IconBolt size={16} /></span>
                <div><h2>Quick actions</h2><p>Common workspace tasks</p></div>
              </div>
            </div>
            <div className="bud-quick-actions">
              <button onClick={newEditor}>
                <span><IconCode size={16} /></span><div><strong>Write a query</strong><small>Open a fresh SQL editor</small></div><IconArrowRight size={14} />
              </button>
              <button onClick={() => connectionTables[0] && void openTableData(connectionTables[0].name)} disabled={!connectionTables.length}>
                <span><IconTable size={16} /></span><div><strong>Browse data</strong><small>{connectionTables[0]?.name ?? "No tables available"}</small></div><IconArrowRight size={14} />
              </button>
              <button onClick={() => window.dispatchEvent(new Event("orbitodb:import-csv"))}>
                <span><IconFileImport size={16} /></span><div><strong>Import CSV</strong><small>Create or append a table</small></div><IconArrowRight size={14} />
              </button>
              <button onClick={() => window.dispatchEvent(new Event("orbitodb:erd"))}>
                <span><IconSchema size={16} /></span><div><strong>Explore relations</strong><small>Open schema diagram</small></div><IconArrowRight size={14} />
              </button>
            </div>
          </section>

          <section className="bud-overview-panel bud-recent-panel">
            <div className="bud-overview-panel-head compact">
              <div>
                <span className="bud-section-icon"><IconClock size={16} /></span>
                <div><h2>Recent activity</h2><p>Queries on this connection</p></div>
              </div>
            </div>
            <div className="bud-overview-recent">
              {recent.length === 0 ? (
                <div className="bud-overview-empty small">
                  <IconClock size={18} />
                  <strong>No query history yet</strong>
                  <span>Your recent statements will appear here.</span>
                </div>
              ) : recent.map((item) => (
                <button key={item.id} onClick={() => loadSql(item.sql)} title={compactSql(item.sql)}>
                  <span className="bud-recent-sql">{compactSql(item.sql)}</span>
                  <span className="bud-recent-time">{relativeTime(item.ranAt)}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
