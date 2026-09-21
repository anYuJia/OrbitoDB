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
import { useI18n } from "../../lib/i18n";
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
  const { t } = useI18n();
  return (
    <PanelShell
      eyebrow={t("workspace.database")}
      title={t("workspace.schemaTools")}
      subtitle={t("workspace.schemaSubtitle")}
    >
      <div className="odb-section">
        <ToolRow
          icon={<IconSchema size={18} stroke={1.6} />}
          title={t("workspace.erDiagram")}
          description={t("workspace.erDescription")}
          action={t("common.open")}
          onClick={() => window.dispatchEvent(new Event("orbitodb:erd"))}
        />
        <ToolRow
          icon={<IconGitCompare size={18} stroke={1.6} />}
          title={t("workspace.schemaDiff")}
          description={t("workspace.diffDescription")}
          action={t("common.compare")}
          onClick={() => window.dispatchEvent(new Event("orbitodb:schema-diff"))}
        />
        <ToolRow
          icon={<IconArrowsDiff size={18} stroke={1.6} />}
          title={t("workspace.migrationPreview")}
          description={t("workspace.migrationDescription")}
          action={t("common.generate")}
          onClick={() => window.dispatchEvent(new Event("orbitodb:schema-diff"))}
        />
      </div>
    </PanelShell>
  );
}

function UtilitiesPanel() {
  const { locale, t } = useI18n();
  const newEditor = useStore((s) => s.newEditor);
  const activeId = useStore((s) => s.activeConnectionId);
  const activeConnection = useStore((s) => s.connections.find((connection) => connection.id === s.activeConnectionId));
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const readOnly = useStore((s) =>
    s.activeConnectionId ? s.readOnlyConns.includes(s.activeConnectionId) : false,
  );
  const activeTable = useStore((s) => s.editTable?.table ?? null);
  const runMaintenance = useStore((s) => s.runMaintenance);
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
      eyebrow={t("workspace.workspace")}
      title={t("workspace.utilities")}
      subtitle={t("workspace.utilitiesSubtitle")}
    >
      <div className="odb-section">
        <ToolRow
          icon={<IconTerminal2 size={18} stroke={1.6} />}
          title={t("workspace.newSqlConsole")}
          description={t("workspace.newSqlDescription")}
          action={t("common.open")}
          onClick={newEditor}
        />
        <ToolRow
          icon={<IconKey size={18} stroke={1.6} />}
          title={t("workspace.reconnectActive")}
          description={activeConnection ? t("workspace.reconnectDescription", { name: activeConnection.name }) : t("workspace.selectConnectionFirst")}
          action={activeId ? t("common.reconnect") : t("common.unavailable")}
          disabled={!activeId}
          onClick={() => activeId && void openAndIntrospect(activeId)}
        />
        <ToolRow
          icon={<IconDatabaseSearch size={18} stroke={1.6} />}
          title={t("workspace.crossTableSearch")}
          description={t("workspace.crossTableSearchDescription")}
          action={activeId ? t("common.search") : t("common.unavailable")}
          disabled={!activeId}
          onClick={() => window.dispatchEvent(new Event("orbitodb:cross-table-search"))}
        />
      </div>

      <div className="odb-section">
        <div className="odb-utility-section-head">
          <div>
            <span className="odb-page-eyebrow">{t("workspace.maintenance")}</span>
            <b>{activeTable ? activeTable : t("workspace.noTableSelected")}</b>
          </div>
        </div>
        <ToolRow
          icon={<IconDatabaseSearch size={18} stroke={1.6} />}
          title={t("workspace.analyzeTable")}
          description={
            activeTable
              ? t("workspace.analyzeDescription")
              : t("workspace.analyzeOpenTable")
          }
          action={activeTable ? "Analyze" : t("common.unavailable")}
          disabled={!activeId || !activeTable || readOnly}
          onClick={() => activeTable && void runMaintenance("analyze", activeTable)}
        />
        <ToolRow
          icon={<IconRefresh size={18} stroke={1.6} />}
          title={
            activeConnection?.engine === "sqlite"
              ? t("workspace.optimizeSqlite")
              : activeConnection?.engine === "postgres"
                ? t("workspace.vacuumAnalyze")
                 : t("workspace.optimizeTable")
          }
          description={
            activeConnection?.engine === "sqlite"
              ? t("workspace.optimizeSqliteDescription")
              : activeTable
                ? t("workspace.optimizeDescription")
                 : t("workspace.optimizeOpenTable")
          }
          action={
            activeConnection?.engine === "sqlite"
              ? "Optimize"
              : activeTable
                ? t("common.run")
                : t("common.unavailable")
          }
          disabled={
            !activeId ||
            readOnly ||
            (!!activeConnection && activeConnection.engine !== "sqlite" && !activeTable)
          }
          onClick={() =>
            void runMaintenance(
              "optimize",
              activeConnection?.engine === "sqlite" ? null : activeTable,
            )
          }
        />
        {activeConnection?.engine === "sqlite" && (
          <ToolRow
            icon={<IconRefresh size={18} stroke={1.6} />}
            title={t("workspace.vacuumSqlite")}
            description={t("workspace.vacuumDescription")}
            action="Vacuum"
            disabled={!activeId || readOnly}
            onClick={() => void runMaintenance("vacuum")}
          />
        )}
      </div>

      <div className="odb-section">
        <div className="odb-utility-section-head">
          <div>
            <span className="odb-page-eyebrow">{t("workspace.backupRestore")}</span>
            <b>{activeConnection ? activeConnection.name : t("workspace.noActive")}</b>
          </div>
        </div>

        {!activeConnection ? (
          <div className="odb-empty-state compact">
            <IconDatabaseSearch size={22} stroke={1.5} />
            <b>{t("workspace.selectConnection")}</b>
            <span>{t("workspace.backupScoped")}</span>
          </div>
        ) : activeConnection.engine === "sqlite" ? (
          <>
            <ToolRow
              icon={<IconDatabaseSearch size={18} stroke={1.6} />}
              title={t("workspace.createSnapshot")}
              description={t("workspace.createSnapshotDescription")}
              action={backupBusy ? t("common.working") : t("common.create")}
              disabled={backupBusy}
              onClick={() => void createSnapshot()}
            />
            {backupError && <div className="odb-structure-meta-error">{backupError}</div>}
            <div className="odb-backup-list">
              {backups.length === 0 ? (
                <div className="odb-backup-empty">{t("workspace.noSnapshots")}</div>
              ) : (
                backups.map((backup) => (
                  <div className="odb-backup-row" key={backup.id}>
                    <div>
                      <b>{new Date(backup.createdAt).toLocaleString(locale)}</b>
                      <span>{formatBytes(backup.sizeBytes)} · {backup.id}</span>
                      {backup.path && <code title={backup.path}>{backup.path}</code>}
                    </div>
                    <button
                      onClick={() => void restoreSnapshot(backup)}
                      disabled={backupBusy || readOnly}
                      title={readOnly ? t("workspace.restoreBlocked") : t("workspace.restoreSnapshot")}
                    >
                      <IconRefresh size={13} stroke={1.8} />
                      {t("common.restore")}
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
              description={t("workspace.nativeBackupDescription")}
              action={t("common.copy")}
              onClick={() => copyCommand(nativeCommands.backup, "backup command")}
            />
            <ToolRow
              icon={<IconCopy size={18} stroke={1.6} />}
              title={activeConnection.engine === "postgres" ? "pg_restore command" : "mysql restore command"}
              description={t("workspace.nativeRestoreDescription")}
              action={t("common.copy")}
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
  const { locale, setLocale, t } = useI18n();
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
      const key = connection.group?.trim() || t("workspace.ungrouped");
      const items = groups.get(key) ?? [];
      items.push(connection);
      groups.set(key, items);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === t("workspace.ungrouped")) return 1;
      if (b === t("workspace.ungrouped")) return -1;
      return a.localeCompare(b);
    });
  }, [connections]);

  const engineName = (engine: string) =>
    engine === "postgres" ? "PostgreSQL" : engine === "mysql" ? "MySQL / MariaDB" : "SQLite";

  return (
    <PanelShell
      eyebrow={t("workspace.workspace")}
      title="Connections"
      subtitle="Manage local database profiles, safety settings and the active workspace connection."
    >
      <div className="odb-preference-row">
        <div>
          <span className="odb-page-eyebrow">{t("workspace.preferences")}</span>
          <b>{t("workspace.language")}</b>
          <p>{t("workspace.languageDescription")}</p>
        </div>
        <div className="odb-segmented" role="group" aria-label={t("workspace.language")}>
          <button className={locale === "en-US" ? "on" : ""} onClick={() => setLocale("en-US")}>
            {t("workspace.english")}
          </button>
          <button className={locale === "zh-CN" ? "on" : ""} onClick={() => setLocale("zh-CN")}>
            {t("workspace.chinese")}
          </button>
        </div>
      </div>

      <div className="odb-connection-manager-head">
        <div>
          <b>{t("workspace.savedConnections")}</b>
          <span>{t("workspace.storedLocally", { count: connections.length, label: t(connections.length === 1 ? "common.profile" : "common.profiles") })}</span>
        </div>
        <button className="primary" onClick={onAddConnection}>
          <IconPlus size={14} stroke={2} />
          {t("top.newConnection")}
        </button>
      </div>

      <div className="odb-connection-manager-list">
        {connections.length === 0 ? (
          <button className="odb-connection-manager-empty" onClick={onAddConnection}>
            <IconPlugConnected size={22} stroke={1.5} />
            <b>{t("workspace.createFirst")}</b>
            <span>{t("workspace.localOnly")}</span>
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
                          {active && <em>{t("common.active")}</em>}
                          {item.env && <em className={`env ${item.env}`}>{item.env.toUpperCase()}</em>}
                          {ro && <em className="readonly">{t("common.readOnly")}</em>}
                        </span>
                        <span>
                          {engineName(item.engine)}
                          <i>·</i>
                          {item.host ?? t("common.local")}
                          {item.port ? `:${item.port}` : ""}
                          <i>·</i>
                          {item.database}
                          {item.engine === "postgres" ? ` / ${item.schema?.trim() || "public"}` : ""}
                        </span>
                      </span>
                    </button>
                    <button className="odb-connection-manager-edit" title={t("workspace.editConnection")} aria-label={t("workspace.editConnection")} onClick={() => onEditConnection(item)}>
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
          <b>{t("workspace.noActive")}</b>
          <span>{t("workspace.noActiveHint")}</span>
        </div>
      ) : (
        <>
          <div className="odb-connection-detail-head">
            <div>
              <span className="odb-page-eyebrow">{t("workspace.activeConnection")}</span>
              <h2>{conn.name}</h2>
              <p>{engineName(conn.engine)} · {conn.database}</p>
            </div>
            <div className="odb-connection-settings-actions">
              <button onClick={() => onEditConnection(conn)}>
                <IconPencil size={14} stroke={1.8} />
                {t("common.edit")}
              </button>
              <button onClick={() => void openAndIntrospect(conn.id)}>
                <IconRefresh size={14} stroke={1.8} />
                {t("common.reconnect")}
              </button>
              <button onClick={() => void runDiagnostics()} disabled={diagnosticsLoading}>
                <IconDatabaseSearch size={14} stroke={1.8} />
                {diagnosticsLoading ? t("common.checking") : t("workspace.diagnostics")}
              </button>
            </div>
          </div>

          <div className="odb-settings-list">
            {([
              [t("workspace.engine"), engineName(conn.engine)],
              [t("workspace.host"), conn.host ?? t("common.local")],
              [t("workspace.port"), conn.port != null ? String(conn.port) : "—"],
              [t("workspace.databaseLabel"), conn.database],
              ...(conn.engine === "postgres" ? [[t("workspace.schema"), conn.schema?.trim() || "public"] as [string, string]] : []),
              [t("workspace.username"), conn.username ?? "—"],
              [t("workspace.group"), conn.group?.trim() || t("workspace.ungrouped")],
              [t("workspace.environment"), conn.env ? conn.env.toUpperCase() : t("common.none")],
              [
                t("workspace.tls"),
                conn.tls
                  ? `${conn.tls.mode}${conn.tls.caPath ? ` · ${t("workspace.customCA")}` : ` · ${t("workspace.systemRoots")}`}`
                  : t("common.disabled"),
              ],
              [
                t("workspace.ssh"),
                conn.ssh?.enabled
                  ? `${conn.ssh.username}@${conn.ssh.host}:${conn.ssh.port} · ${conn.ssh.auth === "agent" ? t("workspace.agent") : t("workspace.privateKey")}`
                  : t("common.disabled"),
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
              <span className="odb-page-eyebrow">{t("workspace.diagnostics")}</span>
              <h2>{t("workspace.liveConnection")}</h2>
              <p>{t("workspace.liveDescription")}</p>
            </div>
          </div>

          {diagnosticsError && (
            <div className="odb-structure-meta-error">{diagnosticsError}</div>
          )}
          {diagnostics?.connectionId === conn.id ? (
            <div className="odb-settings-list">
              {([
                [t("workspace.serverVersion"), diagnostics.data.serverVersion || "—"],
                [t("workspace.databaseLabel"), diagnostics.data.database || "—"],
                [t("workspace.schema"), diagnostics.data.schema || "—"],
                [t("workspace.roundTrip"), `${diagnostics.data.latencyMs} ms`],
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
              <b>{diagnosticsLoading ? t("workspace.runningDiagnostics") : t("workspace.noDiagnostics")}</b>
              <span>{t("workspace.noDiagnosticsHint")}</span>
            </div>
          )}

          <div className="odb-safety-section">
            <div>
              <span className="odb-page-eyebrow">{t("workspace.safety")}</span>
              <b>{t("workspace.readOnlyMode")}</b>
              <p>{t("workspace.readOnlyDescription")}</p>
            </div>
            <button className={readOnly ? "on" : ""} onClick={() => toggleReadOnly(conn.id)}>
              {readOnly ? <IconLock size={14} stroke={2} /> : <IconLockOpen size={14} stroke={1.8} />}
              {readOnly ? t("common.enabled") : t("common.disabled")}
            </button>
          </div>

          <div className="odb-danger-zone">
            <div>
              <b>{t("workspace.removeConnection")}</b>
              <span>{t("workspace.removeDescription")}</span>
            </div>
            <button
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: t("workspace.deleteConnection"),
                    message: t("workspace.deleteConnectionMessage", { name: conn.name }),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  })
                ) {
                  void deleteConnection(conn.id);
                }
              }}
            >
              <IconTrash size={14} stroke={1.8} />
              {t("common.delete")}
            </button>
          </div>
        </>
      )}
    </PanelShell>
  );
}

