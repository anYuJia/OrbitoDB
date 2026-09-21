import {
  IconDeviceFloppy,
  IconFilePlus,
  IconFolderOpen,
  IconHistory,
  IconKeyboard,
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
  const connectingId = useStore((s) => s.connectingConnectionId);
  const sql = useStore((s) => s.sql);
  const setTopView = useStore((s) => s.setTopView);
  const setView = useStore((s) => s.setView);
  const loadSql = useStore((s) => s.loadSql);
  const newEditor = useStore((s) => s.newEditor);
  const saveScript = useStore((s) => s.saveScript);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const run = useStore((s) => s.run);
  const running = useStore((s) => s.running);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => loadSql(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const save = async () => {
    if (!sql.trim()) return;
    const name = await promptDialog({ title: "Save SQL script", label: "Name", placeholder: "e.g. monthly report" });
    if (name?.trim()) saveScript(name.trim(), sql);
  };

  return (
    <header className="bud-titlebar">
      <div className="bud-tb-brand" aria-label="OrbitoDB home">
        <span className="bud-tb-logo-wrap">
          <img className="bud-tb-logo" src="/orbitodb-logo.svg" alt="" />
        </span>
        <span className="bud-tb-word">OrbitoDB</span>
      </div>

      <div className="bud-tb-tools">
        <button
          className="bud-tb-icon"
          title={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
          aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
          aria-expanded={!sidebarHidden}
          onClick={onToggleSidebar}
        >
          <IconLayoutSidebar size={16} stroke={1.6} />
        </button>
        <span className="bud-tb-divider" />
        <button className="bud-tb-action" title="New SQL editor" onClick={newEditor}>
          <IconFilePlus size={16} stroke={1.6} />
          <span>New query</span>
        </button>
        <button className="bud-tb-icon bud-tb-secondary" title="Open .sql file" aria-label="Open SQL file" onClick={() => fileRef.current?.click()}>
          <IconFolderOpen size={16} stroke={1.6} />
        </button>
        <button className="bud-tb-icon bud-tb-secondary" title="Save as script" aria-label="Save as script" onClick={() => void save()}>
          <IconDeviceFloppy size={16} stroke={1.6} />
        </button>
        <span className="bud-tb-divider" />
        <button className="bud-tb-action" title="New connection" onClick={onAddServer}>
          <IconPlugConnected size={16} stroke={1.6} />
          <span>Connect</span>
        </button>
        <button className="bud-tb-icon bud-tb-secondary" title="Reconnect" aria-label="Reconnect" onClick={() => activeId && void openAndIntrospect(activeId)} disabled={!activeId || !!connectingId || running}>
          <IconRefresh size={16} stroke={1.6} />
        </button>
      </div>

      <div className="bud-title-spacer" />

      <MotionButton
        className="bud-cmdk-pill"
        title="Command palette (⌘K)"
        onClick={() => window.dispatchEvent(new Event("orbitodb:cmdk"))}
      >
        <IconSearch size={14} stroke={1.8} />
        <span>Search commands</span>
        <kbd>⌘K</kbd>
      </MotionButton>

      <div
        className={`bud-tb-conn ${active ? "on" : ""} ${connectingId ? "pending" : ""}`}
        title={connectingId ? `Connecting to ${active?.name ?? "data source"}` : active ? `Connected to ${active.name}` : "No active connection"}
        aria-live="polite"
      >
        <span className="bud-tb-conn-dot" />
        <span>{connectingId ? `Connecting · ${active?.name ?? "data source"}` : active ? active.name : "No connection"}</span>
      </div>

      <MotionButton
        className="bud-tb-run"
        title="Execute query (⌘↵)"
        onClick={() => void run()}
        disabled={!activeId || !!connectingId || running}
        aria-busy={running}
        whileTap={{ scale: 0.96 }}
      >
        <IconPlayerPlay size={15} stroke={2} />
        <span>{running ? "Running…" : "Run"}</span>
      </MotionButton>

      <div className="bud-tb-utility">
        <button title="SQL history" aria-label="SQL history" onClick={() => setView("history")}>
          <IconHistory size={17} stroke={1.7} />
        </button>
        <button title="Settings" aria-label="Settings" onClick={() => setTopView("settings")}>
          <IconSettings size={17} stroke={1.7} />
        </button>
        <button title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => window.dispatchEvent(new Event("orbitodb:shortcuts"))}>
          <IconKeyboard size={17} stroke={1.7} />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".sql,text/plain"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = "";
        }}
      />
    </header>
  );
}
