import {
  IconBrandMysql,
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconColumnInsertRight,
  IconCopy,
  IconDatabase,
  IconDatabaseCog,
  IconEraser,
  IconEye,
  IconFileText,
  IconFilter,
  IconFolderOpen,
  IconHash,
  IconLayoutSidebar,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconFileImport,
  IconGitCompare,
  IconSchema,
  IconSearch,
  IconSettings,
  IconStar,
  IconTable,
  IconTablePlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog, promptDialog } from "../../state/dialog";
import { translate, useI18n } from "../../lib/i18n";
import type { ConnectionConfig, DatabaseObjectInfo, DatabaseObjectKind, Engine } from "../../ipc/types";
import { useStore } from "../../state/store";
import { buildDatabaseObjectTemplate } from "../../lib/databaseObjects";
import { ContextMenu, type CtxAnchor, type MenuItem } from "./ContextMenu";

const PANELS = ["Objects", "Scripts", "Starred"] as const;

function EngineIcon({ engine }: { engine: Engine }) {
  if (engine === "mysql") return <IconBrandMysql size={15} stroke={1.7} />;
  return <IconDatabase size={14} stroke={1.7} />;
}

function engineLabel(engine: Engine): string {
  if (engine === "postgres") return "PostgreSQL";
  if (engine === "mysql") return "MySQL";
  return "SQLite";
}

function connString(c: ConnectionConfig): string {
  if (c.engine === "sqlite") return `sqlite://${c.database}`;
  const user = c.username ? `${c.username}@` : "";
  const host = c.host ?? "localhost";
  const port = c.port ?? (c.engine === "postgres" ? 5432 : 3306);
  const scheme = c.engine === "postgres" ? "postgresql" : "mysql";
  return `${scheme}://${user}${host}:${port}/${c.database}`;
}

/** A collapsible object-type folder inside a connection (Tables, Views, …). */
function ObjectGroup({
  label,
  count,
  defaultOpen = false,
  menu,
  children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  menu?: MenuItem[];
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [ctx, setCtx] = useState<CtxAnchor | null>(null);
  return (
    <div className="bud-objgroup">
      <div
        className="bud-objgroup-head"
        onClick={() => setOpen((v) => !v)}
        onContextMenu={
          menu
            ? (e) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, items: menu });
              }
            : undefined
        }
      >
        <span className="bud-ds-arrow">
          {open ? <IconChevronDown size={12} stroke={2} /> : <IconChevronRight size={12} stroke={2} />}
        </span>
        <IconFolderOpen size={14} stroke={1.7} className="bud-objgroup-ic" />
        <span className="bud-objgroup-label">{label}</span>
        <span className="bud-objgroup-count">{count}</span>
      </div>
      {open && children && <div className="bud-objgroup-body">{children}</div>}
      {ctx && <ContextMenu anchor={ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}

export function Sources({
  onAddServer,
  onEditServer,
  onCreateTable,
}: {
  onAddServer: () => void;
  onEditServer: (conn: ConnectionConfig) => void;
  onCreateTable: () => void;
}) {
  const { t } = useI18n();
  const connections = useStore((s) => s.connections);
  const loadConnections = useStore((s) => s.loadConnections);
  const scanLocal = useStore((s) => s.scanLocal);
  const [filter, setFilter] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [panel, setPanel] = useState<(typeof PANELS)[number]>("Objects");
  const [rootOpen, setRootOpen] = useState(true);
  const [rootCtx, setRootCtx] = useState<CtxAnchor | null>(null);
  const groupedConnections = useMemo(() => {
    const ungrouped: ConnectionConfig[] = [];
    const groups = new Map<string, ConnectionConfig[]>();
    for (const connection of connections) {
      const group = connection.group?.trim();
      if (!group) {
        ungrouped.push(connection);
        continue;
      }
      const items = groups.get(group) ?? [];
      items.push(connection);
      groups.set(group, items);
    }
    return {
      ungrouped,
      groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [connections]);
  const [compact, setCompact] = useState(false);

  const rootMenu: MenuItem[] = [
    { label: t("sources.newConnection"), icon: (<IconPlus size={15} stroke={1.7} />), onClick: onAddServer },
    { label: t("sources.refreshAll"), icon: (<IconRefresh size={15} stroke={1.7} />), onClick: () => { void loadConnections(); void scanLocal(); } },
  ];

  useEffect(() => {
    loadConnections();
    scanLocal();
  }, [loadConnections, scanLocal]);

  return (
    <aside className={`bud-sources ${compact ? "compact" : ""}`}>
      <div className="odb-sidebar-head">
        <div>
          <span className="odb-sidebar-kicker">{t("sources.explorer")}</span>
          <strong>{t("sources.connectionsCount", { count: connections.length, label: t(connections.length === 1 ? "common.connection" : "common.connections") })}</strong>
        </div>
        <button className="odb-sidebar-add" title={t("sources.newConnection")} aria-label={t("sources.newConnection")} onClick={onAddServer}>
          <IconPlus size={14} stroke={2} />
        </button>
      </div>
      <nav className="bud-panel-tabs">
        {PANELS.map((p) => (
          <button key={p} className={`bud-panel-tab ${panel === p ? "on" : ""}`} onClick={() => setPanel(p)}>
            {p === "Objects" ? t("sources.objects") : p === "Scripts" ? t("sources.scripts") : t("sources.starred")}
          </button>
        ))}
      </nav>

      <div className="bud-tree-toolbar">
        <button title={t("sources.newConnection")} aria-label={t("sources.newConnection")} onClick={onAddServer}>
          <IconPlus size={15} stroke={1.8} />
        </button>
        <button
          title={t("sources.refresh")} aria-label={t("sources.refresh")}
          onClick={() => {
            void loadConnections();
            void scanLocal();
          }}
        >
          <IconRefresh size={15} stroke={1.7} />
        </button>
        <button className={searchOpen ? "on" : ""} title={t("sources.filter")} aria-label={t("sources.filter")} onClick={() => setSearchOpen((v) => !v)}>
          <IconFilter size={15} stroke={1.7} />
        </button>
        <button title={t("sources.erDiagram")} aria-label={t("sources.erDiagram")} onClick={() => window.dispatchEvent(new Event("orbitodb:erd"))}>
          <IconSchema size={15} stroke={1.7} />
        </button>
        <button title={t("sources.importCsv")} aria-label={t("sources.importCsv")} onClick={() => window.dispatchEvent(new Event("orbitodb:import-csv"))}>
          <IconFileImport size={15} stroke={1.7} />
        </button>
        <button title={t("sources.schemaDiff")} aria-label={t("sources.schemaDiff")} onClick={() => window.dispatchEvent(new Event("orbitodb:schema-diff"))}>
          <IconGitCompare size={15} stroke={1.7} />
        </button>
        <button
          className={compact ? "on" : ""}
          title={compact ? t("sources.comfortable") : t("sources.compact")} aria-label={compact ? t("sources.comfortable") : t("sources.compact")}
          onClick={() => setCompact((v) => !v)}
        >
          <IconLayoutSidebar size={15} stroke={1.7} />
        </button>
      </div>

      {searchOpen && (
        <div className="bud-src-search">
          <IconSearch size={14} stroke={1.7} />
          <input autoFocus placeholder={t("sources.filterPlaceholder")} aria-label={t("sources.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {filter && (
            <button className="bud-src-search-x" title={t("sources.clear")} aria-label={t("sources.clear")} onClick={() => setFilter("")}>
              <IconX size={13} stroke={1.9} />
            </button>
          )}
        </div>
      )}

      <div className="bud-sources-list">
        {panel === "Objects" ? (
          <>
            <div
              className="bud-tnode root"
              onClick={() => setRootOpen((v) => !v)}
              onContextMenu={(e) => {
                e.preventDefault();
                setRootCtx({ x: e.clientX, y: e.clientY, items: rootMenu });
              }}
            >
              <span className="bud-tnode-arrow">
                {rootOpen ? <IconChevronDown size={13} stroke={2} /> : <IconChevronRight size={13} stroke={2} />}
              </span>
              <IconFolderOpen size={14} stroke={1.7} className="bud-tnode-ic" />
              <span className="bud-tnode-label">{t("sources.savedConnections")}</span>
            </div>
            {rootCtx && <ContextMenu anchor={rootCtx} onClose={() => setRootCtx(null)} />}
            {rootOpen && (
              <div className="bud-tree-children">
                {connections.length === 0 ? (
                  <div className="bud-ds-empty">{t("sources.noConnections")}</div>
                ) : (
                  <>
                    {groupedConnections.ungrouped.map((connection) => (
                      <Datasource
                        key={connection.id}
                        conn={connection}
                        onEditServer={onEditServer}
                        onCreateTable={onCreateTable}
                        filter={filter}
                      />
                    ))}
                    {groupedConnections.groups.map(([group, items]) => (
                      <ConnectionGroup key={group} name={group} count={items.length} items={items}>
                        {items.map((connection) => (
                          <Datasource
                            key={connection.id}
                            conn={connection}
                            onEditServer={onEditServer}
                            onCreateTable={onCreateTable}
                            filter={filter}
                          />
                        ))}
                      </ConnectionGroup>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <SavedList kind={panel} />
        )}
      </div>
    </aside>
  );
}

function ConnectionGroup({
  name,
  count,
  items,
  children,
}: {
  name: string;
  count: number;
  items: ConnectionConfig[];
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [ctx, setCtx] = useState<CtxAnchor | null>(null);
  const saveConnection = useStore((s) => s.saveConnection);

  const renameGroup = async () => {
    const next = await promptDialog({
      title: t("sources.renameGroup"),
      label: t("sources.groupName"),
      defaultValue: name,
      placeholder: t("sources.groupPlaceholder"),
    });
    const value = next?.trim();
    if (!value || value === name) return;
    for (const connection of items) {
      await saveConnection({ ...connection, group: value }, null);
    }
  };

  const ungroup = async () => {
    if (
      !(await confirmDialog({
        title: t("sources.removeGroupTitle"),
        message: t("sources.removeGroupMessage", { count: items.length, name }),
        confirmLabel: t("sources.removeGroup"),
      }))
    ) {
      return;
    }
    for (const connection of items) {
      await saveConnection({ ...connection, group: null }, null);
    }
  };

  const menu: MenuItem[] = [
    { label: t("sources.renameGroup"), icon: (<IconPencil size={15} stroke={1.7} />), onClick: () => void renameGroup() },
    { label: t("sources.ungroupAll"), icon: (<IconFolderOpen size={15} stroke={1.7} />), onClick: () => void ungroup() },
  ];

  return (
    <div className="odb-connection-group">
      <button
        className="odb-connection-group-head"
        onClick={() => setOpen((value) => !value)}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx({ x: e.clientX, y: e.clientY, items: menu });
        }}
      >
        {open ? <IconChevronDown size={12} stroke={2} /> : <IconChevronRight size={12} stroke={2} />}
        <IconFolderOpen size={13} stroke={1.7} />
        <span>{name}</span>
        <em>{count}</em>
      </button>
      {open && <div className="odb-connection-group-body">{children}</div>}
      {ctx && <ContextMenu anchor={ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}

/** Saved SQL snippets and starred queries. */
function SavedList({ kind }: { kind: "Scripts" | "Starred" }) {
  const { t } = useI18n();
  const scripts = useStore((s) => s.scripts);
  const favorites = useStore((s) => s.favorites);
  const loadSql = useStore((s) => s.loadSql);
  const deleteScript = useStore((s) => s.deleteScript);
  const deleteFavorite = useStore((s) => s.deleteFavorite);
  const items = kind === "Scripts" ? scripts : favorites;
  const del = kind === "Scripts" ? deleteScript : deleteFavorite;
  const Icon = kind === "Scripts" ? IconFileText : IconStar;

  if (items.length === 0) {
    return (
      <div className="bud-ds-empty">
        {kind === "Scripts" ? t("sources.noSavedScripts") : t("sources.noStarredQueries")}
      </div>
    );
  }

  return (
    <div className="bud-saved-list">
      {items.map((it) => (
        <div key={it.id} className="bud-saved-row" onClick={() => loadSql(it.sql)} title={it.sql}>
          <span className="bud-saved-ic">
            <Icon size={14} stroke={1.7} />
          </span>
          <span className="bud-saved-name">{it.name}</span>
          <button
            className="bud-saved-del"
            title={translate("sources.deleteSaved")}
            onClick={(e) => {
              e.stopPropagation();
              del(it.id);
            }}
          >
            <IconTrash size={13} stroke={1.7} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Datasource({
  conn,
  onEditServer,
  onCreateTable,
  filter,
}: {
  conn: ConnectionConfig;
  onEditServer: (conn: ConnectionConfig) => void;
  onCreateTable: () => void;
  filter: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [ctx, setCtx] = useState<CtxAnchor | null>(null);
  const activeId = useStore((s) => s.activeConnectionId);
  const tables = useStore((s) => s.schema.tables);
  const objects = useStore((s) => s.schema.objects);
  const loadingTables = useStore((s) => s.loadingTables);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const deleteConnection = useStore((s) => s.deleteConnection);
  const saveConnection = useStore((s) => s.saveConnection);
  const dropTables = useStore((s) => s.dropTables);
  const clearTables = useStore((s) => s.clearTables);
  const setTopView = useStore((s) => s.setTopView);
  const toggleReadOnly = useStore((s) => s.toggleReadOnly);
  const openSqlTab = useStore((s) => s.openSqlTab);
  const createDatabaseView = useStore((s) => s.createDatabaseView);
  const refreshDatabaseObjects = useStore((s) => s.refreshDatabaseObjects);
  const isReadOnly = useStore((s) => s.readOnlyConns.includes(conn.id));
  const isActive = activeId === conn.id;
  const filterText = filter.trim().toLowerCase();
  const baseTables = tables.filter((table) => table.kind === "table");
  const shownTables = filterText
    ? baseTables.filter((table) => table.name.toLowerCase().includes(filterText))
    : baseTables;
  const shownObjects = filterText
    ? objects.filter((object) =>
        [object.name, object.table, object.signature]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(filterText)),
      )
    : objects;
  const objectsOf = (kind: DatabaseObjectKind) =>
    shownObjects.filter((object) => object.kind === kind);

  // Multi-select of tables (Ctrl/Cmd-click toggles, Shift-click ranges).
  const [selTables, setSelTables] = useState<string[]>([]);
  const anchorRef = useRef<string | null>(null);
  const tableNames = shownTables.map((t) => t.name);
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear selection whenever the table set changes
  useEffect(() => {
    setSelTables([]);
    anchorRef.current = null;
  }, [conn.id, tables]);
  const activateTable = (name: string, e: React.MouseEvent): boolean => {
    if (e.altKey) {
      setSelTables((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
      anchorRef.current = name;
      return true;
    }
    if (e.shiftKey && anchorRef.current) {
      const a = tableNames.indexOf(anchorRef.current);
      const b = tableNames.indexOf(name);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelTables(tableNames.slice(lo, hi + 1));
        return true;
      }
    }
    setSelTables([]);
    anchorRef.current = name;
    return false;
  };
  const schemaName = conn.engine === "postgres" ? conn.schema?.trim() || "public" : "main";
  const dbName = conn.database || "database";

  const toggle = async () => {
    if (!isActive) await openAndIntrospect(conn.id);
    setOpen((v) => (isActive ? !v : true));
  };

  const newTable = async () => {
    if (!isActive) await openAndIntrospect(conn.id);
    setOpen(true);
    onCreateTable();
  };
  const rename = async () => {
    const name = await promptDialog({ title: t("sources.renameConnection"), label: t("top.name"), defaultValue: conn.name });
    if (!name?.trim() || name.trim() === conn.name) return;
    await saveConnection({ ...conn, name: name.trim() }, null);
  };
  const moveToGroup = async () => {
    const next = await promptDialog({
      title: t("sources.moveConnection"),
      label: t("sources.groupName"),
      defaultValue: conn.group ?? "",
      placeholder: t("sources.noGroupPlaceholder"),
    });
    if (next == null) return;
    const group = next.trim() || null;
    if (group === (conn.group?.trim() || null)) return;
    await saveConnection({ ...conn, group }, null);
  };
  const copyString = () => void navigator.clipboard?.writeText(connString(conn)).catch(() => {});
  const remove = async () => {
    if (
      await confirmDialog({
        title: t("sources.deleteConnectionTitle"),
        message: t("sources.deleteConnectionMessage", { name: conn.name }),
        confirmLabel: t("common.delete"),
        danger: true,
      })
    ) {
      void deleteConnection(conn.id);
    }
  };

  const items: MenuItem[] = [
    {
      label: isActive ? t("sources.openSelected") : t("sources.connect"),
      icon: (<IconFolderOpen size={15} stroke={1.7} />),
      disabled: isActive,
      onClick: () => void openAndIntrospect(conn.id),
    },
    { label: t("sources.refresh"), icon: (<IconRefresh size={15} stroke={1.7} />), onClick: () => void openAndIntrospect(conn.id) },
    { label: t("sources.newTable"), icon: (<IconTablePlus size={15} stroke={1.7} />), onClick: () => void newTable() },
    { divider: true },
    { label: t("sources.rename"), icon: (<IconPencil size={15} stroke={1.7} />), onClick: () => void rename() },
    { label: conn.group ? t("sources.moveAnotherGroup") : t("sources.moveGroup"), icon: (<IconFolderOpen size={15} stroke={1.7} />), onClick: () => void moveToGroup() },
    { label: t("sources.editConnection"), icon: (<IconDatabaseCog size={15} stroke={1.7} />), onClick: () => onEditServer(conn) },
    {
      label: t("sources.properties"),
      icon: (<IconSettings size={15} stroke={1.7} />),
      onClick: () => {
        void openAndIntrospect(conn.id);
        setTopView("settings");
      },
    },
    {
      label: isReadOnly ? t("sources.readOnlyOn") : t("sources.readOnlyMode"),
      icon: isReadOnly ? (<IconLock size={15} stroke={1.7} />) : (<IconLockOpen size={15} stroke={1.7} />),
      onClick: () => toggleReadOnly(conn.id),
    },
    { label: t("sources.copyConnectionString"), icon: (<IconCopy size={15} stroke={1.7} />), onClick: copyString },
    { divider: true },
    { label: t("sources.removeConnection"), icon: (<IconTrash size={15} stroke={1.7} />), danger: true, onClick: remove },
  ];

  const refresh = () => void openAndIntrospect(conn.id);

  const newView = async () => {
    if (!isActive) await openAndIntrospect(conn.id);
    if (isReadOnly) return;
    const name = await promptDialog({
      title: t("sources.newView"),
      label: t("sources.viewName"),
      placeholder: "active_users",
    });
    if (!name?.trim()) return;
    const query = await promptDialog({
      title: t("sources.newView"),
      label: t("sources.selectQuery"),
      defaultValue: baseTables[0] ? `SELECT * FROM ${baseTables[0].name}` : "SELECT 1 AS value",
      placeholder: "SELECT * FROM users WHERE active = true",
    });
    if (!query?.trim()) return;
    await createDatabaseView(name.trim(), query.trim());
  };

  const newObjectTemplate = async (kind: Exclude<DatabaseObjectKind, "view" | "index">) => {
    if (!isActive) await openAndIntrospect(conn.id);
    let table: string | null = null;
    if (kind === "trigger") {
      const raw = await promptDialog({
        title: "New trigger template",
        label: "Table",
        defaultValue: baseTables[0]?.name ?? "",
        placeholder: "users",
      });
      if (!raw?.trim()) return;
      table = raw.trim();
    }
    try {
      const sql = buildDatabaseObjectTemplate(conn.engine, kind, table);
      openSqlTab(`New ${kind}`, sql);
    } catch {
      // Unsupported engine/object combinations are not exposed below.
    }
  };

  const folderMenu = (kind: DatabaseObjectKind): MenuItem[] => {
    const items: MenuItem[] = [];
    if (kind === "view") {
      items.push({
        label: "New view…",
        icon: (<IconPlus size={15} stroke={1.7} />),
        disabled: isReadOnly,
        onClick: () => void newView(),
      });
    } else if (
      kind === "sequence" ||
      kind === "procedure" ||
      kind === "function" ||
      kind === "trigger"
    ) {
      const unsupported =
        (conn.engine === "sqlite" && (kind === "procedure" || kind === "function" || kind === "sequence")) ||
        (conn.engine === "mysql" && kind === "sequence");
      if (!unsupported) {
        items.push({
          label: `New ${kind} template…`,
          icon: (<IconPlus size={15} stroke={1.7} />),
          onClick: () => void newObjectTemplate(kind),
        });
      }
    }
    if (items.length) items.push({ divider: true });
    items.push({
      label: "Refresh",
      icon: (<IconRefresh size={15} stroke={1.7} />),
      onClick: () => void refreshDatabaseObjects(),
    });
    return items;
  };
  const allNames = baseTables.map((t) => t.name);
  const tablesMenu: MenuItem[] = [
    { label: "New table…", icon: (<IconTablePlus size={15} stroke={1.7} />), onClick: () => void newTable() },
    { label: t("sources.refresh"), icon: (<IconRefresh size={15} stroke={1.7} />), onClick: refresh },
    { divider: true },
    {
      label: `Clear all tables (delete rows)${allNames.length ? ` · ${allNames.length}` : ""}`,
      icon: (<IconEraser size={15} stroke={1.7} />),
      disabled: allNames.length === 0,
      onClick: () => void clearTables(allNames),
    },
    {
      label: `Delete all tables${allNames.length ? ` · ${allNames.length}` : ""}`,
      icon: (<IconTrash size={15} stroke={1.7} />),
      danger: true,
      disabled: allNames.length === 0,
      onClick: () => void dropTables(allNames),
    },
    { divider: true },
    { label: "Reload schema", icon: (<IconDatabaseCog size={15} stroke={1.7} />), onClick: refresh },
  ];

  return (
    <div className={`bud-ds ${isActive ? "connected" : ""}`}>
      <div
        className="bud-src ds"
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx({ x: e.clientX, y: e.clientY, items });
        }}
      >
        <span className="bud-ds-arrow">
          {isActive && open ? <IconChevronDown size={13} stroke={2} /> : <IconChevronRight size={13} stroke={2} />}
        </span>
        <span className="bud-src-ic ds-engine">
          <EngineIcon engine={conn.engine} />
        </span>
        <span className="odb-ds-main">
          <span className="bud-src-name">{conn.name}</span>
          <span className="odb-ds-meta">
            {engineLabel(conn.engine)} · {dbName}{conn.engine === "postgres" ? ` / ${schemaName}` : ""}{conn.ssh?.enabled ? " · SSH" : ""}
          </span>
        </span>
        {conn.env && <span className={`bud-ds-env ${conn.env}`} title={translate("sources.environmentTitle", { env: conn.env.toUpperCase() })} />}
        {isReadOnly && <IconLock size={12} stroke={1.9} className="bud-ds-ro" />}
      </div>
      {isActive && (open || !!filter) && (
        <div className="bud-ds-tables">
          {loadingTables ? (
            <div className="bud-ds-empty">{translate("sources.loading")}</div>
          ) : (
            <>
              <div className="odb-ds-context">
                <span className="odb-ds-context-label">{conn.engine === "postgres" ? translate("sources.schema") : translate("sources.database")}</span>
                <span className="odb-ds-context-value">{conn.engine === "postgres" ? schemaName : dbName}</span>
              </div>
              <ObjectGroup label={translate("sources.tables")} count={shownTables.length} defaultOpen menu={tablesMenu}>
                {shownTables.length === 0 ? (
                  <div className="bud-ds-empty">{filter ? translate("sources.noMatchingTables") : translate("sources.noTables")}</div>
                ) : (
                  shownTables.map((t) => (
                    <TableRow
                      key={t.name}
                      table={t.name}
                      connectionId={conn.id}
                      selected={selTables.includes(t.name)}
                      selectedNames={selTables}
                      onActivate={activateTable}
                    />
                  ))
                )}
              </ObjectGroup>
              <ObjectGroup label={translate("sources.views")} count={objectsOf("view").length} menu={folderMenu("view")}>
                {objectsOf("view").map((object) => (
                  <DatabaseObjectRow key={`view:${object.name}`} object={object} conn={conn} />
                ))}
              </ObjectGroup>
              <ObjectGroup label={translate("sources.indexes")} count={objectsOf("index").length} menu={folderMenu("index")}>
                {objectsOf("index").map((object) => (
                  <DatabaseObjectRow key={`index:${object.table ?? ""}:${object.name}`} object={object} conn={conn} />
                ))}
              </ObjectGroup>
              <ObjectGroup label={translate("sources.triggers")} count={objectsOf("trigger").length} menu={folderMenu("trigger")}>
                {objectsOf("trigger").map((object) => (
                  <DatabaseObjectRow key={`trigger:${object.table ?? ""}:${object.name}`} object={object} conn={conn} />
                ))}
              </ObjectGroup>
              {conn.engine === "postgres" && (
                <ObjectGroup label={translate("sources.sequences")} count={objectsOf("sequence").length} menu={folderMenu("sequence")}>
                  {objectsOf("sequence").map((object) => (
                    <DatabaseObjectRow key={`sequence:${object.name}`} object={object} conn={conn} />
                  ))}
                </ObjectGroup>
              )}
              {conn.engine !== "sqlite" && (
                <ObjectGroup label={translate("sources.procedures")} count={objectsOf("procedure").length} menu={folderMenu("procedure")}>
                  {objectsOf("procedure").map((object) => (
                    <DatabaseObjectRow key={`procedure:${object.name}:${object.signature ?? ""}`} object={object} conn={conn} />
                  ))}
                </ObjectGroup>
              )}
              {conn.engine !== "sqlite" && (
                <ObjectGroup label={translate("sources.functions")} count={objectsOf("function").length} menu={folderMenu("function")}>
                  {objectsOf("function").map((object) => (
                    <DatabaseObjectRow key={`function:${object.name}:${object.signature ?? ""}`} object={object} conn={conn} />
                  ))}
                </ObjectGroup>
              )}
            </>
          )}
        </div>
      )}
      {ctx && <ContextMenu anchor={ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}

function DatabaseObjectRow({
  object,
  conn,
}: {
  object: DatabaseObjectInfo;
  conn: ConnectionConfig;
}) {
  const { t } = useI18n();
  const [ctx, setCtx] = useState<CtxAnchor | null>(null);
  const openSqlTab = useStore((s) => s.openSqlTab);
  const openTableData = useStore((s) => s.openTableData);
  const dropDatabaseObject = useStore((s) => s.dropDatabaseObject);
  const isReadOnly = useStore((s) => s.readOnlyConns.includes(conn.id));

  const showDdl = () => {
    if (!object.definition?.trim()) return;
    openSqlTab(`${object.kind} · ${object.name}`, object.definition);
  };

  const openObject = () => {
    if (object.kind === "view") {
      void openTableData(object.name);
      return;
    }
    if (object.kind === "index" && object.table) {
      void openTableData(object.table);
      return;
    }
    if (object.definition?.trim()) {
      showDdl();
      return;
    }
    if (object.table) void openTableData(object.table);
  };

  const copyName = () => void navigator.clipboard?.writeText(object.name).catch(() => {});

  const drop = async () => {
    if (isReadOnly) return;
    if (
      !(await confirmDialog({
        title: t("sources.dropObjectTitle"),
        message: t("sources.dropObjectMessage", {
          name: object.name,
          parent: object.table ? ` ${t("sources.tables")}: “${object.table}”.` : "",
        }),
        confirmLabel: t("common.delete"),
        danger: true,
      }))
    ) {
      return;
    }
    await dropDatabaseObject(object);
  };

  const canOpen =
    object.kind === "view" ||
    (!!object.table && object.kind === "index") ||
    !!object.definition?.trim() ||
    !!object.table;

  const items: MenuItem[] = [
    {
      label: t("common.open"),
      icon: (<IconFolderOpen size={15} stroke={1.7} />),
      disabled: !canOpen,
      onClick: openObject,
    },
    {
      label: t("sources.showDdl"),
      icon: (<IconSchema size={15} stroke={1.7} />),
      disabled: !object.definition?.trim(),
      onClick: showDdl,
    },
    {
      label: t("sources.copyName"),
      icon: (<IconCopy size={15} stroke={1.7} />),
      onClick: copyName,
    },
    { divider: true },
    {
      label: t("sources.dropObject"),
      icon: (<IconTrash size={15} stroke={1.7} />),
      danger: true,
      disabled: isReadOnly,
      onClick: () => void drop(),
    },
  ];

  const icon =
    object.kind === "view" ? (
      <IconEye size={14} stroke={1.7} />
    ) : object.kind === "index" ? (
      <IconHash size={14} stroke={1.7} />
    ) : object.kind === "sequence" ? (
      <IconSchema size={14} stroke={1.7} />
    ) : (
      <IconCode size={14} stroke={1.7} />
    );

  const meta =
    object.signature?.trim() ||
    (object.table ? `on ${object.table}` : null);

  return (
    <>
      <div
        className="bud-table odb-object-row"
        title={[
          object.kind,
          object.table ? `table: ${object.table}` : "",
          object.signature ? `signature: ${object.signature}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        onClick={openObject}
        onContextMenu={(event) => {
          event.preventDefault();
          setCtx({ x: event.clientX, y: event.clientY, items });
        }}
      >
        <span className="bud-table-ic">{icon}</span>
        <span className="bud-src-name">{object.name}</span>
        {meta && <span className="odb-object-meta">{meta}</span>}
      </div>
      {ctx && <ContextMenu anchor={ctx} onClose={() => setCtx(null)} />}
    </>
  );
}

function TableRow({
  table,
  connectionId,
  selected = false,
  selectedNames = [],
  onActivate,
}: {
  table: string;
  connectionId: string;
  selected?: boolean;
  selectedNames?: string[];
  onActivate?: (name: string, e: React.MouseEvent) => boolean;
}) {
  const { t } = useI18n();
  const [ctx, setCtx] = useState<CtxAnchor | null>(null);
  const openTableData = useStore((s) => s.openTableData);
  const openView = useStore((s) => s.openView);
  const deleteView = useStore((s) => s.deleteView);
  const reload = useStore((s) => s.reload);
  const renameTable = useStore((s) => s.renameTable);
  const dropTable = useStore((s) => s.dropTable);
  const dropTables = useStore((s) => s.dropTables);
  const clearTables = useStore((s) => s.clearTables);
  const editTable = useStore((s) => s.editTable);
  const activeViewId = useStore((s) => s.activeViewId);
  const currentView = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const views = useStore((s) => s.views);
  const loadSql = useStore((s) => s.loadSql);
  const addColumn = useStore((s) => s.addColumn);
  const showTableDdl = useStore((s) => s.showTableDdl);
  const myViews = views.filter((v) => v.connectionId === connectionId && v.table === table);
  const tableActive = editTable?.table === table && activeViewId === null;

  const rename = async () => {
    const name = await promptDialog({ title: t("sources.renameTable"), label: t("top.name"), defaultValue: table });
    if (!name?.trim() || name.trim() === table) return;
    await renameTable(table, name.trim());
  };
  const drop = async () => {
    if (
      await confirmDialog({
        title: t("sources.dropTable"),
        message: t("sources.dropTableMessage", { name: table }),
        confirmLabel: t("common.delete"),
        danger: true,
      })
    ) {
      void dropTable(table);
    }
  };

  const addColumnTo = async () => {
    const name = await promptDialog({ title: t("sources.newColumn"), label: t("sources.columnName"), placeholder: t("sources.columnNamePlaceholder") });
    if (!name?.trim()) return;
    const dataType =
      (await promptDialog({ title: t("sources.columnType"), label: t("sources.columnTypeLabel"), defaultValue: "TEXT" }))?.trim() ||
      "TEXT";
    void addColumn(table, { name: name.trim(), dataType, nullable: true, primaryKey: false });
  };
  const copyName = () => void navigator.clipboard?.writeText(table).catch(() => {});

  const items: MenuItem[] = [
    { label: t("common.open"), icon: (<IconFolderOpen size={15} stroke={1.7} />), onClick: () => void openTableData(table) },
    { label: t("sources.openNewTab"), icon: (<IconPlus size={15} stroke={1.7} />), onClick: () => void openTableData(table, { newTab: true }) },
    { label: t("sources.viewData"), icon: (<IconEye size={15} stroke={1.7} />), onClick: () => void openTableData(table) },
    { label: "Refresh", icon: (<IconRefresh size={15} stroke={1.7} />), onClick: () => void reload(table) },
    { divider: true },
    { label: t("sources.generateSelect"), icon: (<IconCode size={15} stroke={1.7} />), onClick: () => loadSql(`SELECT * FROM ${table} LIMIT 100;`) },
    { label: t("sources.showCreateDdl"), icon: (<IconSchema size={15} stroke={1.7} />), onClick: () => void showTableDdl(table) },
    { label: t("sources.countRows"), icon: (<IconHash size={15} stroke={1.7} />), onClick: () => loadSql(`SELECT count(*) FROM ${table};`) },
    { label: t("sources.addColumn"), icon: (<IconColumnInsertRight size={15} stroke={1.7} />), onClick: () => void addColumnTo() },
    { label: t("sources.copyName"), icon: (<IconCopy size={15} stroke={1.7} />), onClick: copyName },
    { divider: true },
    { label: t("sources.renameTable"), icon: (<IconPencil size={15} stroke={1.7} />), onClick: () => void rename() },
    { label: t("sources.dropTable"), icon: (<IconTrash size={15} stroke={1.7} />), danger: true, onClick: () => void drop() },
  ];

  // When several tables are multi-selected, right-clicking one shows bulk actions.
  const multi = selectedNames.length > 1 && selectedNames.includes(table);
  const bulkItems: MenuItem[] = [
    { label: t("sources.selectedTables", { count: selectedNames.length }), disabled: true },
    { divider: true },
    {
      label: t("sources.clearSelectedTables", { count: selectedNames.length }),
      icon: (<IconEraser size={15} stroke={1.7} />),
      onClick: () => void clearTables(selectedNames),
    },
    {
      label: t("sources.dropSelectedTables", { count: selectedNames.length }),
      icon: (<IconTrash size={15} stroke={1.7} />),
      danger: true,
      onClick: () => void dropTables(selectedNames),
    },
  ];
  const menuItems = multi ? bulkItems : items;

  return (
    <>
      <div
        className={`bud-table ${tableActive ? "active" : ""} ${selected ? "multi" : ""}`}
        onClick={(e) => {
          // Ctrl/Cmd-click opens the table in an additional tab.
          if (e.metaKey || e.ctrlKey) {
            void openTableData(table, { newTab: true });
            return;
          }
          const handled = onActivate?.(table, e) ?? false;
          if (handled) return;
          // Clicking the already-selected table shouldn't reload it — just bring
          // its tab back into view if you'd navigated away to the editor.
          if (tableActive) {
            if (currentView !== "data") setView("data");
            return;
          }
          void openTableData(table);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx({ x: e.clientX, y: e.clientY, items: menuItems });
        }}
      >
        <span className="bud-table-ic">
          <IconTable size={14} stroke={1.7} />
        </span>
        {table}
      </div>
      {myViews.map((v) => (
        <div
          key={v.id}
          className={`bud-table bud-view ${activeViewId === v.id ? "active" : ""}`}
          onClick={() => {
            if (activeViewId === v.id) {
              if (currentView !== "data") setView("data");
              return;
            }
            openView(v);
          }}
        >
          <span className="bud-table-ic">
            <IconFilter size={14} stroke={1.7} />
          </span>
          <span className="bud-src-name">{v.name}</span>
          <button
            className="bud-view-del"
            title={translate("sources.deleteView")}
            onClick={(e) => {
              e.stopPropagation();
              deleteView(v.id);
            }}
          >
            <IconX size={13} stroke={1.8} />
          </button>
        </div>
      ))}
      {ctx && <ContextMenu anchor={ctx} onClose={() => setCtx(null)} />}
    </>
  );
}
