import {
  IconDatabase,
  IconEdit,
  IconLock,
  IconLockOpen,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { ConnectionConfig } from "../../ipc/types";
import { viewV } from "../../lib/motion";
import { confirmDialog } from "../../state/dialog";
import { useStore } from "../../state/store";

export function WorkspacePanel({
  onAddServer,
  onEditServer,
}: {
  onAddServer: () => void;
  onEditServer: (connection: ConnectionConfig) => void;
}) {
  return <SettingsPanel onAddServer={onAddServer} onEditServer={onEditServer} />;
}

function PanelShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <motion.main className="bud-main bud-wp" variants={viewV} initial="hidden" animate="show" exit="exit">
      <div className="bud-wp-head">
        <div>
          <h1 className="bud-wp-title">{title}</h1>
          <p className="bud-wp-sub">{subtitle}</p>
        </div>
        {actions && <div className="bud-wp-head-actions">{actions}</div>}
      </div>
      <div className="bud-wp-body">{children}</div>
    </motion.main>
  );
}

function SettingsPanel({
  onAddServer,
  onEditServer,
}: {
  onAddServer: () => void;
  onEditServer: (connection: ConnectionConfig) => void;
}) {
  const conn = useStore((s) => s.connections.find((connection) => connection.id === s.activeConnectionId));
  const connecting = useStore(
    (s) => s.connectingConnectionId === s.activeConnectionId && s.activeConnectionId != null,
  );
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));
  const toggleReadOnly = useStore((s) => s.toggleReadOnly);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const deleteConnection = useStore((s) => s.deleteConnection);

  if (!conn) {
    return (
      <PanelShell
        title="Connection settings"
        subtitle="Choose a data source to inspect its configuration and safety controls."
        actions={
          <button className="bud-settings-primary" onClick={onAddServer}>
            <IconPlus size={15} stroke={1.9} /> Add data source
          </button>
        }
      >
        <div className="bud-settings-empty">
          <span className="bud-settings-empty-icon">
            <IconDatabase size={24} stroke={1.5} />
          </span>
          <h2>No data source selected</h2>
          <p>Select a saved connection in the sidebar, or add one to start browsing its schema.</p>
        </div>
      </PanelShell>
    );
  }

  const engineName =
    conn.engine === "postgres" ? "PostgreSQL" : conn.engine === "mysql" ? "MySQL / MariaDB" : "SQLite";
  const fields: [string, string][] = [
    ["Name", conn.name],
    ["Engine", engineName],
    ...(conn.engine === "sqlite"
      ? [["Database", conn.database] as [string, string]]
      : ([
          ["Host", conn.host ?? "localhost"],
          ["Port", conn.port != null ? String(conn.port) : "Default"],
          ["Database", conn.database],
          ["Username", conn.username ?? "—"],
        ] as [string, string][])),
    ["Environment", conn.env ? conn.env[0].toUpperCase() + conn.env.slice(1) : "Not set"],
  ];

  const remove = async () => {
    if (
      await confirmDialog({
        title: "Delete connection",
        message: `Delete “${conn.name}”? This removes the saved connection; it does not delete the database itself.`,
        confirmLabel: "Delete connection",
        danger: true,
      })
    ) {
      await deleteConnection(conn.id);
    }
  };

  return (
    <PanelShell
      title="Connection settings"
      subtitle={`Configuration and safety controls for ${conn.name}.`}
      actions={
        <>
          <button
            className="bud-settings-secondary"
            onClick={() => void openAndIntrospect(conn.id)}
            disabled={connecting}
          >
            <IconRefresh size={15} stroke={1.8} className={connecting ? "bud-spin" : ""} />
            {connecting ? "Connecting…" : "Reconnect"}
          </button>
          <button className="bud-settings-primary" onClick={() => onEditServer(conn)}>
            <IconEdit size={15} stroke={1.8} /> Edit connection
          </button>
        </>
      }
    >
      <section className="bud-settings-card" aria-labelledby="connection-details-heading">
        <div className="bud-settings-card-head">
          <div className="bud-settings-card-icon">
            <IconDatabase size={18} stroke={1.6} />
          </div>
          <div>
            <h2 id="connection-details-heading">Connection details</h2>
            <p>Passwords are stored separately and are never shown here.</p>
          </div>
          <span className={`bud-settings-health ${connecting ? "pending" : "active"}`}>
            <i /> {connecting ? "Connecting" : "Active"}
          </span>
        </div>
        <dl className="bud-settings-list">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={label === "Database" || label === "Host" ? "mono" : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bud-settings-card" aria-labelledby="connection-safety-heading">
        <div className="bud-settings-card-head">
          <div className="bud-settings-card-icon safety">
            {readOnly ? <IconLock size={18} stroke={1.7} /> : <IconLockOpen size={18} stroke={1.7} />}
          </div>
          <div>
            <h2 id="connection-safety-heading">Write protection</h2>
            <p>Read-only mode blocks SQL writes and direct table edits in this workspace.</p>
          </div>
          <span className={`bud-settings-health ${readOnly ? "protected" : "off"}`}>
            <i /> {readOnly ? "Protected" : "Writes allowed"}
          </span>
        </div>
        <div className="bud-settings-safety-actions">
          <button
            className="bud-settings-secondary"
            aria-pressed={readOnly}
            onClick={() => toggleReadOnly(conn.id)}
          >
            {readOnly ? <IconLockOpen size={15} stroke={1.8} /> : <IconLock size={15} stroke={1.8} />}
            {readOnly ? "Allow writes" : "Enable read-only"}
          </button>
          <button className="bud-danger-btn" onClick={() => void remove()}>
            <IconTrash size={15} stroke={1.7} /> Delete connection
          </button>
        </div>
      </section>
    </PanelShell>
  );
}
