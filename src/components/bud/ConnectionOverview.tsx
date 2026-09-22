import {
  IconArrowRight,
  IconClock,
  IconCode,
  IconDatabase,
  IconEye,
  IconFileImport,
  IconLock,
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
  const shownTables = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return tables;
    return tables.filter((item) => item.name.toLocaleLowerCase().includes(query));
  }, [filter, tables]);
  const recent = useMemo(
    () => history.filter((item) => item.connectionId === connection?.id).slice(0, 6),
    [connection?.id, history],
  );

  if (!connection) return null;

  const openResource = (item: TableInfo) => void openTableData(item.name);
  const endpoint = connection.engine === "sqlite"
    ? connection.database
    : `${connection.host ?? "localhost"}${connection.port ? `:${connection.port}` : ""}`;

  return (
    <div className="odb-start-center">
      <header className="odb-start-header">
        <div>
          <div className="odb-start-status">
            <span className="odb-live-dot" /> Connected
            <span>{engineName(connection.engine)}</span>
            {connection.env && <em className={`odb-env ${connection.env}`}>{connection.env}</em>}
            {readOnly && <em className="odb-readonly"><IconLock size={12} /> Read-only</em>}
          </div>
          <h1>{connection.name}</h1>
          <p>{endpoint}</p>
        </div>
        <div className="odb-start-actions">
          <button onClick={() => void refreshSchema()} disabled={loading}>
            <IconRefresh size={16} className={loading ? "spin" : ""} />
            {loading ? "Refreshing" : "Refresh"}
          </button>
          <button className="primary" onClick={newEditor}>
            <IconCode size={16} /> New query
          </button>
        </div>
      </header>

      <div className="odb-start-layout">
        <section className="odb-object-browser">
          <div className="odb-section-heading">
            <div>
              <span>Database objects</span>
              <small>{tables.length.toLocaleString()} tables and views</small>
            </div>
            <label className="odb-object-search">
              <IconSearch size={14} />
              <input
                aria-label="Filter schema resources"
                placeholder="Find a table or view…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
          </div>

          <div className="odb-object-head" aria-hidden>
            <span>Name</span><span>Type</span><span>Columns</span><span />
          </div>
          <div className="odb-object-list">
            {loading ? (
              Array.from({ length: 7 }, (_, index) => <div className="odb-object-skeleton" key={index} />)
            ) : shownTables.length === 0 ? (
              <div className="odb-object-empty">
                {filter.trim() ? <IconSearch size={20} /> : <IconDatabase size={20} />}
                <strong>{filter.trim() ? "No matching objects" : "This database is empty"}</strong>
                <span>{filter.trim() ? "Try another name." : "Import a CSV or create your first table."}</span>
                {!filter.trim() && (
                  <button onClick={() => window.dispatchEvent(new Event("orbitodb:import-csv"))}>
                    <IconFileImport size={14} /> Import CSV
                  </button>
                )}
              </div>
            ) : shownTables.slice(0, 18).map((item) => {
              const isView = item.kind.toLowerCase() === "view";
              return (
                <button key={`${item.kind}-${item.name}`} className="odb-object-row" onClick={() => openResource(item)}>
                  <span className={`odb-resource-icon ${isView ? "view" : ""}`}>
                    {isView ? <IconEye size={15} /> : <IconTable size={15} />}
                  </span>
                  <strong>{item.name}</strong>
                  <span>{isView ? "View" : "Table"}</span>
                  <span>{columnsByTable[item.name]?.length ?? "—"}</span>
                  <IconArrowRight size={14} />
                </button>
              );
            })}
          </div>
          {shownTables.length > 18 && <div className="odb-object-foot">Showing 18 of {shownTables.length.toLocaleString()} objects</div>}
        </section>

        <aside className="odb-start-aside">
          <section className="odb-continue-panel">
            <div className="odb-section-heading">
              <div><span>Continue working</span><small>Recent statements</small></div>
              <IconClock size={16} />
            </div>
            <div className="odb-recent-list">
              {recent.length === 0 ? (
                <div className="odb-inline-empty">Run a query and it will appear here.</div>
              ) : recent.map((item) => (
                <button key={item.id} onClick={() => loadSql(item.sql)} title={compactSql(item.sql)}>
                  <code>{compactSql(item.sql)}</code>
                  <span>{relativeTime(item.ranAt)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="odb-quick-panel">
            <div className="odb-section-heading"><div><span>Quick actions</span><small>Common tasks</small></div></div>
            <button onClick={newEditor}><IconCode size={16} /><span><strong>Write a query</strong><small>Open a blank SQL document</small></span><IconArrowRight size={14} /></button>
            <button onClick={() => connectionTables[0] && void openTableData(connectionTables[0].name)} disabled={!connectionTables.length}><IconTable size={16} /><span><strong>Browse data</strong><small>{connectionTables[0]?.name ?? "No tables available"}</small></span><IconArrowRight size={14} /></button>
            <button onClick={() => window.dispatchEvent(new Event("orbitodb:import-csv"))}><IconFileImport size={16} /><span><strong>Import CSV</strong><small>Create or append a table</small></span><IconArrowRight size={14} /></button>
            <button onClick={() => window.dispatchEvent(new Event("orbitodb:erd"))}><IconSchema size={16} /><span><strong>Schema diagram</strong><small>Explore table relations</small></span><IconArrowRight size={14} /></button>
          </section>

          <section className="odb-connection-details">
            <span>Connection</span>
            <dl>
              <div><dt>Engine</dt><dd>{engineName(connection.engine)}</dd></div>
              <div><dt>Database</dt><dd>{connection.database}</dd></div>
              <div><dt>Access</dt><dd>{readOnly ? "Read-only" : "Read and write"}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
