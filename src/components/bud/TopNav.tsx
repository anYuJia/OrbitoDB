import {
  IconDeviceFloppy,
  IconFilePlus,
  IconFolderOpen,
  IconHistory,
  IconLanguage,
  IconLayoutSidebar,
  IconPlayerPlay,
  IconPlugConnected,
  IconRefresh,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { useRef } from "react";
import { useI18n } from "../../lib/i18n";
import { isMacPlatform, shortcutLabel } from "../../lib/platform";
import { MotionButton } from "../../lib/motion";
import { promptDialog } from "../../state/dialog";
import { useStore } from "../../state/store";

function TrafficLights() {
  if (!isMacPlatform()) return null;
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
  const { isZh, t, toggleLocale } = useI18n();
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
  const commandShortcut = shortcutLabel("K");
  const sidebarShortcut = shortcutLabel("B");
  const runShortcut = shortcutLabel("Enter");

  const openFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => loadSql(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const save = async () => {
    if (!sql.trim()) return;
    const name = await promptDialog({
      title: t("top.saveScript"),
      label: t("top.name"),
      placeholder: t("top.scriptPlaceholder"),
    });
    if (name?.trim()) saveScript(name.trim(), sql);
  };

  return (
    <header className="bud-titlebar odb-titlebar">
      <div className="odb-title-left">
        <TrafficLights />
        <button
          className={`odb-icon-btn ${sidebarHidden ? "" : "on"}`}
          title={`${sidebarHidden ? t("top.showExplorer") : t("top.hideExplorer")} (${sidebarShortcut})`}
          aria-label={sidebarHidden ? t("top.showExplorer") : t("top.hideExplorer")}
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
          <span className="odb-connection-name">{active?.name ?? t("top.noConnection")}</span>
          {active && <span className="odb-connection-meta">{active.engine}</span>}
        </div>
      </div>

      <div className="odb-title-actions">
        <button className="odb-icon-btn" title={t("top.newQuery")} aria-label={t("top.newQuery")} onClick={newEditor}>
          <IconFilePlus size={16} stroke={1.7} />
        </button>
        <button className="odb-icon-btn" title={t("top.openSql")} aria-label={t("top.openSql")} onClick={() => fileRef.current?.click()}>
          <IconFolderOpen size={16} stroke={1.7} />
        </button>
        <button
          className="odb-icon-btn"
          title={t("top.saveQuery")}
          aria-label={t("top.saveQuery")}
          disabled={!sql.trim()}
          onClick={() => void save()}
        >
          <IconDeviceFloppy size={16} stroke={1.7} />
        </button>
        <span className="odb-title-separator" />
        <button className="odb-icon-btn" title={t("top.newConnection")} aria-label={t("top.newConnection")} onClick={onAddServer}>
          <IconPlugConnected size={16} stroke={1.7} />
        </button>
        <button
          className="odb-icon-btn"
          title={t("top.reconnect")}
          aria-label={t("top.reconnect")}
          disabled={!activeId}
          onClick={() => activeId && void openAndIntrospect(activeId)}
        >
          <IconRefresh size={16} stroke={1.7} />
        </button>
        <button className="odb-icon-btn" title={t("top.history")} aria-label={t("top.history")} onClick={() => setView("history")}>
          <IconHistory size={16} stroke={1.7} />
        </button>
        <button
          className="odb-icon-btn odb-language-btn"
          title={isZh ? t("top.switchEnglish") : t("top.switchChinese")}
          aria-label={t("top.language")}
          onClick={toggleLocale}
        >
          <IconLanguage size={16} stroke={1.7} />
          <span>{isZh ? "中" : "EN"}</span>
        </button>
        <button className="odb-icon-btn" title={t("top.settings")} aria-label={t("top.settings")} onClick={() => setTopView("settings")}>
          <IconSettings size={16} stroke={1.7} />
        </button>
        <button
          className="odb-search-btn"
          title={t("top.commandPalette", { shortcut: commandShortcut })}
          onClick={() => window.dispatchEvent(new Event("orbitodb:cmdk"))}
        >
          <IconSearch size={14} stroke={1.8} />
          <span>{t("top.search")}</span>
          <kbd>{commandShortcut}</kbd>
        </button>
        <MotionButton
          className="odb-run-btn"
          title={t("top.execute", { shortcut: runShortcut })}
          onClick={() => void run()}
          disabled={!activeId}
          whileTap={{ scale: 0.96 }}
        >
          <IconPlayerPlay size={14} stroke={2} />
          <span>{t("common.run")}</span>
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
