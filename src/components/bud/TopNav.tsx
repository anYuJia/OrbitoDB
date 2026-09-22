import {
  IconDatabase,
  IconDeviceFloppy,
  IconDots,
  IconFilePlus,
  IconFolderOpen,
  IconHistory,
  IconKeyboard,
  IconLayoutSidebar,
  IconLayoutDashboard,
  IconPlugConnected,
  IconRefresh,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
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
  const active = useStore((state) => state.connections.find((item) => item.id === state.activeConnectionId));
  const activeId = useStore((state) => state.activeConnectionId);
  const connectingId = useStore((state) => state.connectingConnectionId);
  const sql = useStore((state) => state.sql);
  const setTopView = useStore((state) => state.setTopView);
  const setView = useStore((state) => state.setView);
  const loadSql = useStore((state) => state.loadSql);
  const newEditor = useStore((state) => state.newEditor);
  const saveScript = useStore((state) => state.saveScript);
  const openAndIntrospect = useStore((state) => state.openAndIntrospect);
  const running = useStore((state) => state.running);
  const fileRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [moreOpen]);

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

  const goOverview = () => {
    setTopView("data");
    if (activeId) setView("overview");
  };

  const menuAction = (action: () => void) => {
    setMoreOpen(false);
    action();
  };

  return (
    <header className="bud-titlebar">
      <div className="bud-tb-leading">
        <button
          className="bud-tb-icon bud-sidebar-toggle"
          title={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
          aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
          aria-expanded={!sidebarHidden}
          onClick={onToggleSidebar}
        >
          <IconLayoutSidebar size={17} stroke={1.7} />
        </button>
        <button className="bud-tb-brand" aria-label="Open workspace overview" onClick={goOverview}>
          <span className="bud-tb-logo-wrap"><img className="bud-tb-logo" src="/orbitodb-logo.svg" alt="" /></span>
          <span className="bud-tb-word">OrbitoDB</span>
        </button>
      </div>

      {active ? (
        <button
          className={`bud-tb-context ${connectingId ? "pending" : ""}`}
          onClick={goOverview}
          title="Open connection overview"
        >
          <span className="bud-tb-conn-dot" />
          <span className="bud-tb-context-copy">
            <strong>{active.name}</strong>
            <small>{active.engine} · {active.database}</small>
          </span>
          {active.env && <span className={`bud-tb-env ${active.env}`}>{active.env}</span>}
          <IconLayoutDashboard size={14} stroke={1.7} />
        </button>
      ) : (
        <button className="bud-tb-context empty" onClick={onAddServer}>
          <span className="bud-tb-context-icon"><IconDatabase size={15} /></span>
          <span className="bud-tb-context-copy"><strong>Select a database</strong><small>Connect to start working</small></span>
        </button>
      )}

      <div className="bud-title-spacer" />

      <MotionButton
        className="bud-cmdk-pill"
        title="Command palette (⌘K)"
        onClick={() => window.dispatchEvent(new Event("orbitodb:cmdk"))}
      >
        <IconSearch size={14} stroke={1.8} />
        <span>Search or jump to…</span>
        <kbd>⌘K</kbd>
      </MotionButton>

      <button className="bud-tb-new-query" onClick={newEditor}>
        <IconFilePlus size={16} stroke={1.8} />
        <span>New query</span>
      </button>

      <button
        className="bud-tb-icon bud-tb-settings"
        title="Workspace settings"
        aria-label="Workspace settings"
        onClick={() => setTopView("settings")}
      >
        <IconSettings size={17} stroke={1.7} />
      </button>

      <div className="bud-tb-more" ref={moreRef}>
        <button
          className={`bud-tb-icon ${moreOpen ? "on" : ""}`}
          title="More workspace actions"
          aria-label="More workspace actions"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        >
          <IconDots size={18} stroke={1.8} />
        </button>
        {moreOpen && (
          <div className="bud-tb-menu" role="menu">
            <button role="menuitem" onClick={() => menuAction(() => fileRef.current?.click())}>
              <IconFolderOpen size={15} /> Open SQL file
            </button>
            <button role="menuitem" disabled={!sql.trim()} onClick={() => menuAction(() => void save())}>
              <IconDeviceFloppy size={15} /> Save current script
            </button>
            <span className="bud-tb-menu-sep" />
            <button role="menuitem" onClick={() => menuAction(() => { setTopView("data"); setView("history"); })} disabled={!activeId}>
              <IconHistory size={15} /> Query history
            </button>
            <button
              role="menuitem"
              disabled={!activeId || !!connectingId || running}
              onClick={() => menuAction(() => { setTopView("data"); if (activeId) void openAndIntrospect(activeId); })}
            >
              <IconRefresh size={15} /> Reconnect database
            </button>
            <button role="menuitem" onClick={() => menuAction(() => window.dispatchEvent(new Event("orbitodb:shortcuts")))}>
              <IconKeyboard size={15} /> Keyboard shortcuts
            </button>
            <span className="bud-tb-menu-sep" />
            <button role="menuitem" onClick={() => menuAction(onAddServer)}>
              <IconPlugConnected size={15} /> Add connection
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".sql,text/plain"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) openFile(file);
          event.target.value = "";
        }}
      />
    </header>
  );
}
