import {
  IconDeviceFloppy,
  IconFilePlus,
  IconFolderOpen,
  IconHistory,
  IconLayoutSidebar,
  IconPlayerPlay,
  IconPlugConnected,
  IconRefresh,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { useRef } from "react";
import { MotionButton } from "../../lib/motion";
import { promptDialog } from "../../state/dialog";
import { useStore } from "../../state/store";

function TrafficLights() {
  return (
    <div className="odb-traffic" aria-hidden>
      <span className="r" />
      <span className="y" />
      <span className="g" />
    </div>
  );
}

export function TopNav({
  onAddServer,
  onToggleSidebar,
  sidebarHidden,
}: {
  onAddServer: () => void;
  onToggleSidebar: () => void;
  sidebarHidden: boolean;
}) {
  const active = useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId));
  const activeId = useStore((s) => s.activeConnectionId);
  const sql = useStore((s) => s.sql);
  const setTopView = useStore((s) => s.setTopView);
  const setView = useStore((s) => s.setView);
  const loadSql = useStore((s) => s.loadSql);
  const newEditor = useStore((s) => s.newEditor);
  const saveScript = useStore((s) => s.saveScript);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const run = useStore((s) => s.run);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => loadSql(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const save = async () => {
    if (!sql.trim()) return;
    const name = await promptDialog({
      title: "Save SQL script",
      label: "Name",
      placeholder: "e.g. monthly-report",
    });
    if (name?.trim()) saveScript(name.trim(), sql);
  };

  return (
    <header className="bud-titlebar odb-titlebar">
      <div className="odb-title-left">
        <TrafficLights />
        <button
          className={`odb-icon-btn ${sidebarHidden ? "" : "on"}`}
          title={sidebarHidden ? "Show database explorer" : "Hide database explorer"}
          onClick={onToggleSidebar}
        >
          <IconLayoutSidebar size={16} stroke={1.7} />
        </button>
        <div className="odb-brand">
          <img src="/orbitodb-logo.svg" alt="" />
          <span>OrbitoDB</span>
        </div>
      </div>

      <div className="odb-title-center">
        <div className={`odb-connection-pill ${active ? "connected" : ""}`}>
          <span className="odb-connection-dot" />
          <span className="odb-connection-name">{active?.name ?? "No connection"}</span>
          {active && <span className="odb-connection-meta">{active.engine}</span>}
        </div>
      </div>

      <div className="odb-title-actions">
        <button className="odb-icon-btn" title="New SQL tab" onClick={newEditor}>
          <IconFilePlus size={16} stroke={1.7} />
        </button>
        <button className="odb-icon-btn" title="Open SQL file" onClick={() => fileRef.current?.click()}>
          <IconFolderOpen size={16} stroke={1.7} />
        </button>
        <button className="odb-icon-btn" title="Save query" disabled={!sql.trim()} onClick={() => void save()}>
          <IconDeviceFloppy size={16} stroke={1.7} />
        </button>
        <span className="odb-title-separator" />
        <button className="odb-icon-btn" title="New connection" onClick={onAddServer}>
          <IconPlugConnected size={16} stroke={1.7} />
        </button>
        <button
          className="odb-icon-btn"
          title="Reconnect"
          disabled={!activeId}
          onClick={() => activeId && void openAndIntrospect(activeId)}
        >
          <IconRefresh size={16} stroke={1.7} />
        </button>
        <button className="odb-icon-btn" title="Query history" onClick={() => setView("history")}>
          <IconHistory size={16} stroke={1.7} />
        </button>
        <button className="odb-icon-btn" title="Settings" onClick={() => setTopView("settings")}>
          <IconSettings size={16} stroke={1.7} />
        </button>
        <button
          className="odb-search-btn"
          title="Command palette (⌘K)"
          onClick={() => window.dispatchEvent(new Event("orbitodb:cmdk"))}
        >
          <IconSearch size={14} stroke={1.8} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <MotionButton
          className="odb-run-btn"
          title="Execute query (⌘↵)"
          onClick={() => void run()}
          disabled={!activeId}
          whileTap={{ scale: 0.96 }}
        >
          <IconPlayerPlay size={14} stroke={2} />
          <span>Run</span>
        </MotionButton>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".sql,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = "";
        }}
      />
    </header>
  );
}
