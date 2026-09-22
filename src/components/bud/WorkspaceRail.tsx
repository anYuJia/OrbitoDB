import {
  IconClock,
  IconDatabase,
  IconFileText,
  IconSchema,
  IconSettings,
  IconStar,
} from "@tabler/icons-react";

export type ExplorerPanel = "Databases" | "Scripts" | "Favorites";

export function WorkspaceRail({
  panel,
  historyActive,
  settingsActive,
  onPanel,
  onHistory,
  onSettings,
}: {
  panel: ExplorerPanel;
  historyActive: boolean;
  settingsActive: boolean;
  onPanel: (panel: ExplorerPanel) => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  const item = (
    id: string,
    label: string,
    icon: React.ReactNode,
    active: boolean,
    action: () => void,
  ) => (
    <button
      key={id}
      className={`odb-rail-item ${active ? "active" : ""}`}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      onClick={action}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <nav className="odb-rail" aria-label="Workspace navigation">
      <div className="odb-rail-main">
        {item("explorer", "Explorer", <IconDatabase size={19} stroke={1.65} />, !historyActive && !settingsActive && panel === "Databases", () => onPanel("Databases"))}
        {item("queries", "Saved queries", <IconFileText size={19} stroke={1.65} />, !historyActive && !settingsActive && panel === "Scripts", () => onPanel("Scripts"))}
        {item("favorites", "Favorites", <IconStar size={19} stroke={1.65} />, !historyActive && !settingsActive && panel === "Favorites", () => onPanel("Favorites"))}
        {item("history", "Query history", <IconClock size={19} stroke={1.65} />, historyActive, onHistory)}
      </div>
      <div className="odb-rail-footer">
        <button
          className="odb-rail-item"
          aria-label="Schema diagram"
          title="Schema diagram"
          onClick={() => window.dispatchEvent(new Event("orbitodb:erd"))}
        >
          <IconSchema size={19} stroke={1.65} />
          <span>Schema diagram</span>
        </button>
        {item("settings", "Settings", <IconSettings size={19} stroke={1.65} />, settingsActive, onSettings)}
      </div>
    </nav>
  );
}
