import { AnimatePresence } from "framer-motion";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "../ipc/types";
import { installSmoothScroll } from "../lib/smoothScroll";
import { useStore } from "../state/store";
import { DataView } from "./bud/DataView";
import { DialogHost } from "./bud/DialogHost";
import { Sources } from "./bud/Sources";
import { StatusBar } from "./bud/StatusBar";
import { ToastHost } from "./bud/ToastHost";
import { TopNav } from "./bud/TopNav";
import { WorkspaceRail, type ExplorerPanel } from "./bud/WorkspaceRail";

const ServerModal = lazy(() => import("./bud/ServerModal").then((mod) => ({ default: mod.ServerModal })));
const WorkspacePanel = lazy(() => import("./bud/WorkspacePanel").then((mod) => ({ default: mod.WorkspacePanel })));
const CommandPalette = lazy(() => import("./dash/CommandPalette").then((mod) => ({ default: mod.CommandPalette })));
const ShortcutsOverlay = lazy(() => import("./bud/ShortcutsOverlay").then((mod) => ({ default: mod.ShortcutsOverlay })));
const ErDiagram = lazy(() => import("./bud/ErDiagram").then((mod) => ({ default: mod.ErDiagram })));
const ImportCsvModal = lazy(() => import("./bud/ImportCsvModal").then((mod) => ({ default: mod.ImportCsvModal })));
const SchemaDiff = lazy(() => import("./bud/SchemaDiff").then((mod) => ({ default: mod.SchemaDiff })));

type DeferredOverlay = "command" | "shortcuts" | "erd" | "importCsv" | "schemaDiff";
const EMPTY_OVERLAYS: Record<DeferredOverlay, boolean> = {
  command: false,
  shortcuts: false,
  erd: false,
  importCsv: false,
  schemaDiff: false,
};

function initialWidth(): number {
  try {
    return Number(localStorage.getItem("orbitodb.sidebarW")) || 256;
  } catch {
    return 256;
  }
}

type Theme = "dark" | "light";

function initialTheme(): Theme {
  try {
    return localStorage.getItem("orbitodb.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function initialSidebarHidden(): boolean {
  try {
    const saved = localStorage.getItem("orbitodb.sidebarHidden");
    if (saved != null) return saved === "true";
    return window.matchMedia("(max-width: 720px)").matches;
  } catch {
    return false;
  }
}

export function AppShell() {
  const [serverModal, setServerModal] = useState<ConnectionConfig | "new" | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(initialSidebarHidden);
  const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
  const [explorerPanel, setExplorerPanel] = useState<ExplorerPanel>("Databases");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [overlays, setOverlays] = useState(EMPTY_OVERLAYS);
  const shellRef = useRef<HTMLDivElement>(null);
  const topView = useStore((s) => s.topView);
  const view = useStore((s) => s.view);
  const setTopView = useStore((s) => s.setTopView);
  const setView = useStore((s) => s.setView);
  const restoreSession = useStore((s) => s.restoreSession);

  // Restore the last connection + editor contents on load.
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // Smooth (eased) mouse-wheel scrolling across every scroll container.
  useEffect(() => installSmoothScroll(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("orbitodb.theme", theme);
    } catch {
      /* keep the in-memory preference */
    }
  }, [theme]);

  // Keep feature-heavy overlays out of the startup bundle. This tiny event
  // gate catches their first invocation; once mounted, each overlay continues
  // handling its own open/close shortcuts as before.
  useEffect(() => {
    const load = (name: DeferredOverlay) => setOverlays((state) => (state[name] ? state : { ...state, [name]: true }));
    const onCommand = () => load("command");
    const onShortcuts = () => load("shortcuts");
    const onErd = () => load("erd");
    const onImport = () => load("importCsv");
    const onSchemaDiff = () => load("schemaDiff");
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        load("command");
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "?" && !typing) {
        e.preventDefault();
        load("shortcuts");
      }
    };
    window.addEventListener("orbitodb:cmdk", onCommand);
    window.addEventListener("orbitodb:shortcuts", onShortcuts);
    window.addEventListener("orbitodb:erd", onErd);
    window.addEventListener("orbitodb:import-csv", onImport);
    window.addEventListener("orbitodb:schema-diff", onSchemaDiff);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("orbitodb:cmdk", onCommand);
      window.removeEventListener("orbitodb:shortcuts", onShortcuts);
      window.removeEventListener("orbitodb:erd", onErd);
      window.removeEventListener("orbitodb:import-csv", onImport);
      window.removeEventListener("orbitodb:schema-diff", onSchemaDiff);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const openAdd = () => setServerModal("new");
  const openEdit = (c: ConnectionConfig) => setServerModal(c);

  const showExplorerPanel = (panel: ExplorerPanel) => {
    setExplorerPanel(panel);
    setTopView("data");
    if (view === "history") setView("overview");
    if (sidebarHidden) toggleSidebar();
  };

  const toggleSidebar = () => {
    setSidebarHidden((hidden) => {
      const next = !hidden;
      try {
        localStorage.setItem("orbitodb.sidebarHidden", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const closeMobileSidebar = () => {
    if (!window.matchMedia("(max-width: 720px)").matches) return;
    setSidebarHidden(true);
    try {
      localStorage.setItem("orbitodb.sidebarHidden", "true");
    } catch {
      /* ignore */
    }
  };

  const saveSidebarWidth = (width: number) => {
    try {
      localStorage.setItem("orbitodb.sidebarW", String(width));
    } catch {
      /* ignore */
    }
  };

  const resizeSidebar = (width: number) => {
    const next = Math.max(224, Math.min(width, 360));
    setSidebarWidth(next);
    return next;
  };

  const onResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    shellRef.current?.classList.add("is-resizing");
    let last = sidebarWidth;
    const move = (ev: PointerEvent) => {
      last = resizeSidebar(ev.clientX);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      shellRef.current?.classList.remove("is-resizing");
      saveSidebarWidth(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home") return;
    e.preventDefault();
    const next = e.key === "Home" ? 256 : resizeSidebar(sidebarWidth + (e.key === "ArrowLeft" ? -16 : 16));
    setSidebarWidth(next);
    saveSidebarWidth(next);
  };

  return (
    <div
      ref={shellRef}
      className={`bud-app ${sidebarHidden ? "sidebar-hidden" : ""}`}
      style={{ ["--sidebar-w" as string]: `${sidebarWidth}px` }}
    >
      <TopNav
        onAddServer={openAdd}
        onToggleSidebar={toggleSidebar}
        sidebarHidden={sidebarHidden}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
      <div className="bud-body">
        <WorkspaceRail
          panel={explorerPanel}
          historyActive={topView === "data" && view === "history"}
          settingsActive={topView === "settings"}
          onPanel={showExplorerPanel}
          onHistory={() => {
            setTopView("data");
            setView("history");
          }}
          onSettings={() => setTopView("settings")}
        />
        <Sources panel={explorerPanel} onAddServer={openAdd} onEditServer={openEdit} onNavigate={closeMobileSidebar} />
        {!sidebarHidden && (
          <button className="odb-sidebar-scrim" aria-label="Close sidebar" onClick={toggleSidebar} />
        )}
        <AnimatePresence mode="wait" initial={false}>
          {topView === "data" ? (
            <DataView key="data" onAddServer={openAdd} />
          ) : (
            <Suspense
              key={topView}
              fallback={
                <main className="bud-main bud-route-loading" aria-busy="true" aria-label="Loading workspace">
                  <span className="bud-loading-spinner" />
                  Loading workspace…
                </main>
              }
            >
              <WorkspacePanel onAddServer={openAdd} onEditServer={openEdit} />
            </Suspense>
          )}
        </AnimatePresence>
      </div>
      {!sidebarHidden && (
        <div
          className="bud-hsplit"
          role="separator"
          aria-label="Resize data sources sidebar"
          aria-orientation="vertical"
          aria-valuemin={224}
          aria-valuemax={360}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={onResize}
          onKeyDown={onResizeKey}
          onDoubleClick={() => {
            setSidebarWidth(256);
            saveSidebarWidth(256);
          }}
          title="Drag to resize · Double-click to reset"
        />
      )}
      <StatusBar />
      <AnimatePresence>
        {serverModal && (
          <Suspense
            key="server-modal"
            fallback={
              <div className="bud-modal-backdrop bud-modal-loading" role="status" aria-label="Loading connection dialog">
                <span className="bud-loading-spinner" />
              </div>
            }
          >
            <ServerModal
              existing={serverModal === "new" ? null : serverModal}
              onClose={() => setServerModal(null)}
            />
          </Suspense>
        )}
      </AnimatePresence>
      {overlays.command && (
        <Suspense fallback={<div className="bud-modal-backdrop bud-modal-loading"><span className="bud-loading-spinner" /></div>}>
          <CommandPalette onAddServer={openAdd} initialOpen />
        </Suspense>
      )}
      {overlays.shortcuts && (
        <Suspense fallback={<div className="bud-modal-backdrop bud-modal-loading"><span className="bud-loading-spinner" /></div>}>
          <ShortcutsOverlay initialOpen />
        </Suspense>
      )}
      {overlays.erd && (
        <Suspense fallback={<div className="bud-modal-backdrop bud-modal-loading"><span className="bud-loading-spinner" /></div>}>
          <ErDiagram initialOpen />
        </Suspense>
      )}
      {overlays.importCsv && (
        <Suspense fallback={<div className="bud-modal-backdrop bud-modal-loading"><span className="bud-loading-spinner" /></div>}>
          <ImportCsvModal initialOpen />
        </Suspense>
      )}
      {overlays.schemaDiff && (
        <Suspense fallback={<div className="bud-modal-backdrop bud-modal-loading"><span className="bud-loading-spinner" /></div>}>
          <SchemaDiff initialOpen />
        </Suspense>
      )}
      <ToastHost />
      <DialogHost />
    </div>
  );
}
