import {
  IconArrowsDiff,
  IconCopy,
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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { viewV } from "../../lib/motion";
import { buildNativeBackupCommands } from "../../lib/backup";
import { getBackend } from "../../ipc/backend";
import type { BackupInfo, ConnectionDiagnostics } from "../../ipc/types";
import { confirmDialog } from "../../state/dialog";
import { confirmProdWrite } from "../../state/safety";
import { toast } from "../../state/toast";
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
          description="Compare two connections and generate a review-first migration script."
          action="Generate"
          onClick={() => window.dispatchEvent(new Event("orbitodb:schema-diff"))}
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
  const readOnly = useStore((s) =>
    s.activeConnectionId ? s.readOnlyConns.includes(s.activeConnectionId) : false,
  );
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  const loadBackups = async () => {
    if (!activeId || activeConnection?.engine !== "sqlite") {
      setBackups([]);
      return;
    }
    try {
      setBackupError(null);
      setBackups(await getBackend().listBackups(activeId));
    } catch (error) {
      setBackups([]);
      setBackupError(
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? "Could not load backups")
          : String(error),
      );
    }
  };

  useEffect(() => {
    void loadBackups();
    // Reload when the active connection changes. Backup mutations call this
    // function explicitly after completing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeConnection?.engine]);

  const createSnapshot = async () => {
    if (!activeId || activeConnection?.engine !== "sqlite" || backupBusy) return;
    setBackupBusy(true);
    setBackupError(null);
    try {
      const backup = await getBackend().createBackup(activeId);
      toast(`Created SQLite snapshot ${backup.id}`, "success");
      await loadBackups();
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? "Backup failed")
          : String(error);
      setBackupError(message);
      toast(message, "error");
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreSnapshot = async (backup: BackupInfo) => {
    if (!activeId || !activeConnection || activeConnection.engine !== "sqlite" || backupBusy) return;
    if (readOnly) {
      toast("Read-only — restore is blocked.", "error");
      return;
    }
    if (
      !(await confirmDialog({
        title: "Restore SQLite snapshot?",
        message:
          `Restore “${backup.id}”? OrbitoDB will create a safety snapshot of the current database first, then replace the active SQLite file.`,
        confirmLabel: "Restore",
        danger: true,
      }))
    ) {
      return;
    }
    if (!(await confirmProdWrite(activeConnection, "RESTORE SQLITE BACKUP"))) return;

    setBackupBusy(true);
    setBackupError(null);
    try {
      await getBackend().restoreBackup(activeId, backup.id);
      await openAndIntrospect(activeId);
      await loadBackups();
      toast(`Restored snapshot ${backup.id}`, "success");
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? "Restore failed")
          : String(error);
      setBackupError(message);
      toast(message, "error");
    } finally {
      setBackupBusy(false);
    }
  };

  const nativeCommands =
    activeConnection && activeConnection.engine !== "sqlite"
      ? buildNativeBackupCommands(activeConnection)
      : null;

  const copyCommand = (command: string, label: string) => {
    void navigator.clipboard
      ?.writeText(command)
      .then(() => toast(`Copied ${label}`, "success"))
      .catch(() => toast("Clipboard unavailable", "error"));
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

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
          description="Search visible values across tables and jump directly to a matching row."
          action={activeId ? "Search" : "Unavailable"}
          disabled={!activeId}
          onClick={() => window.dispatchEvent(new Event("orbitodb:cross-table-search"))}
        />
      </div>

      <div className="odb-section">
        <div className="odb-utility-section-head">
          <div>
            <span className="odb-page-eyebrow">Backup & restore</span>
            <b>{activeConnection ? activeConnection.name : "No active connection"}</b>
          </div>
        </div>

        {!activeConnection ? (
          <div className="odb-empty-state compact">
            <IconDatabaseSearch size={22} stroke={1.5} />
            <b>Select a connection</b>
            <span>Backup tools are scoped to the active database.</span>
          </div>
        ) : activeConnection.engine === "sqlite" ? (
          <>
            <ToolRow
              icon={<IconDatabaseSearch size={18} stroke={1.6} />}
              title="Create SQLite snapshot"
              description="Create a consistent managed backup without adding filesystem permissions."
              action={backupBusy ? "Working…" : "Create"}
              disabled={backupBusy}
              onClick={() => void createSnapshot()}
            />
            {backupError && <div className="odb-structure-meta-error">{backupError}</div>}
            <div className="odb-backup-list">
              {backups.length === 0 ? (
                <div className="odb-backup-empty">No managed snapshots yet.</div>
              ) : (
                backups.map((backup) => (
                  <div className="odb-backup-row" key={backup.id}>
                    <div>
                      <b>{new Date(backup.createdAt).toLocaleString()}</b>
                      <span>{formatBytes(backup.sizeBytes)} · {backup.id}</span>
                      {backup.path && <code title={backup.path}>{backup.path}</code>}
                    </div>
                    <button
                      onClick={() => void restoreSnapshot(backup)}
                      disabled={backupBusy || readOnly}
                      title={readOnly ? "Restore is blocked by Read-only mode" : "Restore this snapshot"}
                    >
                      <IconRefresh size={13} stroke={1.8} />
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        ) : nativeCommands ? (
          <>
            <ToolRow
              icon={<IconTerminal2 size={18} stroke={1.6} />}
              title={activeConnection.engine === "postgres" ? "pg_dump backup command" : "mysqldump backup command"}
              description="Copy a native logical backup command. Passwords are never embedded."
              action="Copy"
              onClick={() => copyCommand(nativeCommands.backup, "backup command")}
            />
            <ToolRow
              icon={<IconCopy size={18} stroke={1.6} />}
              title={activeConnection.engine === "postgres" ? "pg_restore command" : "mysql restore command"}
              description="Copy the matching native restore command for this connection."
              action="Copy"
              onClick={() => copyCommand(nativeCommands.restore, "restore command")}
            />
            <div className="odb-utility-note">{nativeCommands.note}</div>
          </>
        ) : null}
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
  const [diagnostics, setDiagnostics] = useState<{ connectionId: string; data: ConnectionDiagnostics } | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

  const runDiagnostics = async () => {
    if (!conn || diagnosticsLoading) return;
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      let data: ConnectionDiagnostics;
      try {
        data = await getBackend().connectionDiagnostics(conn.id);
      } catch (error) {
        if ((error as { kind?: string })?.kind !== "notConnected") throw error;
        await openAndIntrospect(conn.id);
        data = await getBackend().connectionDiagnostics(conn.id);
      }
      setDiagnostics({ connectionId: conn.id, data });
    } catch (error) {
      setDiagnosticsError(
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? "Diagnostics failed")
          : String(error),
      );
    } finally {
      setDiagnosticsLoading(false);
    }
  };
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
              <button onClick={() => void runDiagnostics()} disabled={diagnosticsLoading}>
                <IconDatabaseSearch size={14} stroke={1.8} />
                {diagnosticsLoading ? "Checking…" : "Diagnostics"}
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

          <div className="odb-connection-detail-divider" />

          <div className="odb-connection-detail-head compact">
            <div>
              <span className="odb-page-eyebrow">Diagnostics</span>
              <h2>Live connection</h2>
              <p>Probe the active session instead of relying on saved profile metadata.</p>
            </div>
          </div>

          {diagnosticsError && (
            <div className="odb-structure-meta-error">{diagnosticsError}</div>
          )}
          {diagnostics?.connectionId === conn.id ? (
            <div className="odb-settings-list">
              {([
                ["Server version", diagnostics.data.serverVersion || "—"],
                ["Database", diagnostics.data.database || "—"],
                ["Schema", diagnostics.data.schema || "—"],
                ["Round-trip", `${diagnostics.data.latencyMs} ms`],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="odb-setting-line">
                  <span>{label}</span>
                  <code>{value}</code>
                </div>
              ))}
            </div>
          ) : (
            <div className="odb-empty-state compact">
              <IconDatabaseSearch size={22} stroke={1.5} />
              <b>{diagnosticsLoading ? "Running diagnostics…" : "No live diagnostics yet"}</b>
              <span>Use Diagnostics above to query the active database session.</span>
            </div>
          )}

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

