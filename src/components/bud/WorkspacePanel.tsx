import {
  IconArrowsDiff,
  IconDatabaseSearch,
  IconGitCompare,
  IconKey,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconPlugConnected,
  IconRefresh,
  IconSchema,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useMemo, type ReactNode } from "react";
import { viewV } from "../../lib/motion";
import { confirmDialog } from "../../state/dialog";
import type { TopView } from "../../state/store";
import { useStore } from "../../state/store";

export function WorkspacePanel({
  view,
  onEditConnection,
  onAddConnection,
}: {
  view: TopView;
  onEditConnection: (conn: import("../../ipc/types").ConnectionConfig) => void;
  onAddConnection: () => void;
}) {
  if (view === "design") return <SchemaToolsPanel />;
  if (view === "automation") return <UtilitiesPanel />;
  return <SettingsPanel onEditConnection={onEditConnection} onAddConnection={onAddConnection} />;
}

function PanelShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <motion.main className="bud-main odb-page" variants={viewV} initial="hidden" animate="show" exit="exit">
      <div className="odb-page-head">
        <span className="odb-page-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="odb-page-body">{children}</div>
    </motion.main>
  );
}

function ToolRow({
  icon,
  title,
  description,
  action,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="odb-tool-row" onClick={onClick} disabled={disabled}>
      <span className="odb-tool-icon">{icon}</span>
      <span className="odb-tool-copy">
        <b>{title}</b>
        <span>{description}</span>
      </span>
      <span className="odb-tool-action">{action}</span>
    </button>
  );
}

function SchemaToolsPanel() {
  return (
    <PanelShell
      eyebrow="Database"
      title="Schema tools"
      subtitle="Inspect and compare database structure without leaving the desktop client."
    >
      <div className="odb-section">
        <ToolRow
          icon={<IconSchema size={18} stroke={1.6} />}
          title="ER diagram"
          description="Visualize tables, columns and foreign-key relationships."
          action="Open"
          onClick={() => window.dispatchEvent(new Event("orbitodb:erd"))}
        />
        <ToolRow
          icon={<IconGitCompare size={18} stroke={1.6} />}
          title="Schema diff"
          description="Compare tables and column types across two saved connections."
          action="Compare"
          onClick={() => window.dispatchEvent(new Event("orbitodb:schema-diff"))}
        />
        <ToolRow
          icon={<IconArrowsDiff size={18} stroke={1.6} />}
          title="Migration preview"
          description="Generate and review engine-aware schema migrations."
          action="Planned"
          disabled
        />
      </div>
    </PanelShell>
  );
}

function UtilitiesPanel() {
  const newEditor = useStore((s) => s.newEditor);
  const activeId = useStore((s) => s.activeConnectionId);
  const activeConnection = useStore((s) => s.connections.find((connection) => connection.id === s.activeConnectionId));
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);

  return (
    <PanelShell
      eyebrow="Workspace"
      title="Utilities"
      subtitle="Database-focused tools that run locally with the current OrbitoDB workspace."
    >
      <div className="odb-section">
        <ToolRow
          icon={<IconTerminal2 size={18} stroke={1.6} />}
          title="New SQL console"
          description="Open another isolated SQL editor tab."
          action="Open"
          onClick={newEditor}
        />
        <ToolRow
          icon={<IconKey size={18} stroke={1.6} />}
          title="Reconnect active connection"
          description={activeConnection ? `Reconnect and refresh schema metadata for ${activeConnection.name}.` : "Select a connection first."}
          action={activeId ? "Reconnect" : "Unavailable"}
          disabled={!activeId}
          onClick={() => activeId && void openAndIntrospect(activeId)}
        />
        <ToolRow
          icon={<IconDatabaseSearch size={18} stroke={1.6} />}
          title="Cross-table data search"
          description="Search a value across multiple tables and columns."
          action="Planned"
          disabled
        />
      </div>
    </PanelShell>
  );
}

function SettingsPanel({
  onEditConnection,
  onAddConnection,
}: {
  onEditConnection: (conn: import("../../ipc/types").ConnectionConfig) => void;
  onAddConnection: () => void;
}) {
  const connections = useStore((s) => s.connections);
  const activeId = useStore((s) => s.activeConnectionId);
  const conn = connections.find((connection) => connection.id === activeId) ?? null;
  const deleteConnection = useStore((s) => s.deleteConnection);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const toggleReadOnly = useStore((s) => s.toggleReadOnly);
  const readOnlyConns = useStore((s) => s.readOnlyConns);
  const readOnly = !!conn && readOnlyConns.includes(conn.id);
  const groupedConnections = useMemo(() => {
    const groups = new Map<string, typeof connections>();
    for (const connection of connections) {
      const key = connection.group?.trim() || "Ungrouped";
      const items = groups.get(key) ?? [];
      items.push(connection);
      groups.set(key, items);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "Ungrouped") return 1;
      if (b === "Ungrouped") return -1;
      return a.localeCompare(b);
    });
  }, [connections]);

  const engineName = (engine: string) =>
    engine === "postgres" ? "PostgreSQL" : engine === "mysql" ? "MySQL / MariaDB" : "SQLite";

  return (
    <PanelShell
      eyebrow="Workspace"
      title="Connections"
      subtitle="Manage local database profiles, safety settings and the active workspace connection."
    >
      <div className="odb-connection-manager-head">
        <div>
          <b>Saved connections</b>
          <span>{connections.length} {connections.length === 1 ? "profile" : "profiles"} stored locally</span>
        </div>
        <button className="primary" onClick={onAddConnection}>
          <IconPlus size={14} stroke={2} />
          New connection
        </button>
      </div>

      <div className="odb-connection-manager-list">
        {connections.length === 0 ? (
          <button className="odb-connection-manager-empty" onClick={onAddConnection}>
            <IconPlugConnected size={22} stroke={1.5} />
            <b>Create your first connection</b>
            <span>Profiles and credentials stay on this device.</span>
          </button>
        ) : (
          groupedConnections.map(([groupName, items]) => (
            <section className="odb-connection-manager-group" key={groupName}>
              <div className="odb-connection-manager-group-head">
                <span>{groupName}</span>
                <em>{items.length}</em>
              </div>
              {items.map((item) => {
                const active = item.id === activeId;
                const ro = readOnlyConns.includes(item.id);
                return (
                  <div key={item.id} className={`odb-connection-manager-row ${active ? "active" : ""}`}>
                    <button className="odb-connection-manager-main" onClick={() => void openAndIntrospect(item.id)}>
                      <span className="odb-connection-manager-dot" />
                      <span className="odb-connection-manager-copy">
                        <span className="odb-connection-manager-name">
                          <b>{item.name}</b>
                          {active && <em>Active</em>}
                          {item.env && <em className={`env ${item.env}`}>{item.env.toUpperCase()}</em>}
                          {ro && <em className="readonly">Read-only</em>}
                        </span>
                        <span>
                          {engineName(item.engine)}
                          <i>·</i>
                          {item.host ?? "Local"}
                          {item.port ? `:${item.port}` : ""}
                          <i>·</i>
                          {item.database}
                          {item.engine === "postgres" ? ` / ${item.schema?.trim() || "public"}` : ""}
                        </span>
                      </span>
                    </button>
                    <button className="odb-connection-manager-edit" title="Edit connection" onClick={() => onEditConnection(item)}>
                      <IconPencil size={13} stroke={1.8} />
                    </button>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>

      <div className="odb-connection-detail-divider" />

      {!conn ? (
        <div className="odb-empty-state compact">
          <IconPlugConnected size={24} stroke={1.4} />
          <b>No active connection</b>
          <span>Select a saved profile above or create a new one.</span>
        </div>
      ) : (
        <>
          <div className="odb-connection-detail-head">
            <div>
              <span className="odb-page-eyebrow">Active connection</span>
              <h2>{conn.name}</h2>
              <p>{engineName(conn.engine)} · {conn.database}</p>
            </div>
            <div className="odb-connection-settings-actions">
              <button onClick={() => onEditConnection(conn)}>
                <IconPencil size={14} stroke={1.8} />
                Edit
              </button>
              <button onClick={() => void openAndIntrospect(conn.id)}>
                <IconRefresh size={14} stroke={1.8} />
                Reconnect
              </button>
            </div>
          </div>

          <div className="odb-settings-list">
            {([
              ["Engine", engineName(conn.engine)],
              ["Host", conn.host ?? "Local"],
              ["Port", conn.port != null ? String(conn.port) : "—"],
              ["Database", conn.database],
              ...(conn.engine === "postgres" ? [["Schema", conn.schema?.trim() || "public"] as [string, string]] : []),
              ["Username", conn.username ?? "—"],
              ["Group", conn.group?.trim() || "Ungrouped"],
              ["Environment", conn.env ? conn.env.toUpperCase() : "None"],
              [
                "TLS / SSL",
                conn.tls
                  ? `${conn.tls.mode}${conn.tls.caPath ? " · custom CA" : " · system roots"}`
                  : "Disabled",
              ],
              [
                "SSH tunnel",
                conn.ssh?.enabled
                  ? `${conn.ssh.username}@${conn.ssh.host}:${conn.ssh.port} · ${conn.ssh.auth === "agent" ? "Agent" : "Private key"}`
                  : "Disabled",
              ],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="odb-setting-line">
                <span>{label}</span>
                <code>{value}</code>
              </div>
            ))}
          </div>

          <div className="odb-safety-section">
            <div>
              <span className="odb-page-eyebrow">Safety</span>
              <b>Read-only mode</b>
              <p>Block INSERT, UPDATE, DELETE and other write statements for this connection.</p>
            </div>
            <button className={readOnly ? "on" : ""} onClick={() => toggleReadOnly(conn.id)}>
              {readOnly ? <IconLock size={14} stroke={2} /> : <IconLockOpen size={14} stroke={1.8} />}
              {readOnly ? "Enabled" : "Disabled"}
            </button>
          </div>

          <div className="odb-danger-zone">
            <div>
              <b>Remove saved connection</b>
              <span>This only removes the local OrbitoDB profile. It does not change the database server.</span>
            </div>
            <button
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: "Delete connection",
                    message: `Delete "${conn.name}"? This removes the saved local connection only.`,
                    confirmLabel: "Delete",
                    danger: true,
                  })
                ) {
                  void deleteConnection(conn.id);
                }
              }}
            >
              <IconTrash size={14} stroke={1.8} />
              Delete
            </button>
          </div>
        </>
      )}
    </PanelShell>
  );
}

