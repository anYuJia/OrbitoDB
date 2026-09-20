import {
  IconArrowsDiff,
  IconDatabaseSearch,
  IconGitCompare,
  IconKey,
  IconPlugConnected,
  IconSchema,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { viewV } from "../../lib/motion";
import { confirmDialog } from "../../state/dialog";
import { toast } from "../../state/toast";
import type { TopView } from "../../state/store";
import { useStore } from "../../state/store";

export function WorkspacePanel({ view }: { view: TopView }) {
  if (view === "design") return <SchemaToolsPanel />;
  if (view === "automation") return <UtilitiesPanel />;
  return <SettingsPanel />;
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
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: string;
}) {
  return (
    <button className="odb-tool-row" onClick={() => toast(`${title} is planned for a later OrbitoDB milestone.`, "info")}>
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
        <ToolRow icon={<IconSchema size={18} stroke={1.6} />} title="ER diagram" description="Visualize tables and relationships." action="Open" />
        <ToolRow icon={<IconGitCompare size={18} stroke={1.6} />} title="Schema diff" description="Compare structures across two connections." action="Compare" />
        <ToolRow icon={<IconArrowsDiff size={18} stroke={1.6} />} title="Migration preview" description="Review DDL changes before applying them." action="Preview" />
      </div>
    </PanelShell>
  );
}

function UtilitiesPanel() {
  return (
    <PanelShell
      eyebrow="Workspace"
      title="Utilities"
      subtitle="Database-focused utilities. No cloud account or hosted workspace required."
    >
      <div className="odb-section">
        <ToolRow icon={<IconDatabaseSearch size={18} stroke={1.6} />} title="Data search" description="Search values across selected tables." action="Search" />
        <ToolRow icon={<IconTerminal2 size={18} stroke={1.6} />} title="SQL console" description="Open another isolated query session." action="Open" />
        <ToolRow icon={<IconKey size={18} stroke={1.6} />} title="Credential check" description="Verify locally stored connection credentials." action="Check" />
      </div>
    </PanelShell>
  );
}

function SettingsPanel() {
  const conn = useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId));
  const deleteConnection = useStore((s) => s.deleteConnection);

  if (!conn) {
    return (
      <PanelShell eyebrow="Connection" title="Connection settings" subtitle="Select a connection from Database Explorer to inspect it.">
        <div className="odb-empty-state">
          <IconPlugConnected size={26} stroke={1.4} />
          <b>No connection selected</b>
          <span>Your saved connections stay local to this device.</span>
        </div>
      </PanelShell>
    );
  }

  const fields: [string, string][] = [
    ["Name", conn.name],
    ["Engine", conn.engine === "postgres" ? "PostgreSQL" : conn.engine === "mysql" ? "MySQL / MariaDB" : "SQLite"],
    ["Host", conn.host ?? "Local"],
    ["Port", conn.port != null ? String(conn.port) : "—"],
    ["Database", conn.database],
    ["Username", conn.username ?? "—"],
  ];

  return (
    <PanelShell eyebrow="Connection" title={conn.name} subtitle="Connection metadata and local safety controls.">
      <div className="odb-settings-list">
        {fields.map(([label, value]) => (
          <div key={label} className="odb-setting-line">
            <span>{label}</span>
            <code>{value}</code>
          </div>
        ))}
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
    </PanelShell>
  );
}
