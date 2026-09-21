import { AnimatePresence } from "framer-motion";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "../ipc/types";
import { installSmoothScroll } from "../lib/smoothScroll";
import { useStore } from "../state/store";
import { DataView } from "./bud/DataView";
import { DialogHost } from "./bud/DialogHost";
import { ErDiagram } from "./bud/ErDiagram";
import { ImportCsvModal } from "./bud/ImportCsvModal";
import { SchemaDiff } from "./bud/SchemaDiff";
import { ShortcutsOverlay } from "./bud/ShortcutsOverlay";
import { Sources } from "./bud/Sources";
import { StatusBar } from "./bud/StatusBar";
import { ToastHost } from "./bud/ToastHost";
import { TopNav } from "./bud/TopNav";
import { CommandPalette } from "./dash/CommandPalette";

const ServerModal = lazy(() => import("./bud/ServerModal").then((mod) => ({ default: mod.ServerModal })));
const WorkspacePanel = lazy(() => import("./bud/WorkspacePanel").then((mod) => ({ default: mod.WorkspacePanel })));

function initialWidth(): number {
  try {
    return Number(localStorage.getItem("orbitodb.sidebarW")) || 292;
  } catch {
    return 292;
  }
}

function initialSidebarHidden(): boolean {
  try {
    return localStorage.getItem("orbitodb.sidebarHidden") === "true";
  } catch {
    return false;
  }
}

export function AppShell() {
  const [serverModal, setServerModal] = useState<ConnectionConfig | "new" | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(initialSidebarHidden);
  const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
  const shellRef = useRef<HTMLDivElement>(null);
  const topView = useStore((s) => s.topView);
  const restoreSession = useStore((s) => s.restoreSession);

  // Restore the last connection + editor contents on load.
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // Smooth (eased) mouse-wheel scrolling across every scroll container.
  useEffect(() => installSmoothScroll(), []);

  const openAdd = () => setServerModal("new");
  const openEdit = (c: ConnectionConfig) => setServerModal(c);

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

  const saveSidebarWidth = (width: number) => {
    try {
      localStorage.setItem("orbitodb.sidebarW", String(width));
    } catch {
      /* ignore */
    }
  };

  const resizeSidebar = (width: number) => {
    const next = Math.max(240, Math.min(width, 480));
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
    const next = e.key === "Home" ? 292 : resizeSidebar(sidebarWidth + (e.key === "ArrowLeft" ? -16 : 16));
    setSidebarWidth(next);
    saveSidebarWidth(next);
  };

  return (
    <div
      ref={shellRef}
      className={`bud-app ${sidebarHidden ? "sidebar-hidden" : ""}`}
      style={{ ["--sidebar-w" as string]: `${sidebarWidth}px` }}
    >
      <TopNav onAddServer={openAdd} onToggleSidebar={toggleSidebar} sidebarHidden={sidebarHidden} />
      <div className="bud-body">
        <Sources onAddServer={openAdd} onEditServer={openEdit} />
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
              <WorkspacePanel view={topView} />
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
          aria-valuemin={240}
          aria-valuemax={480}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={onResize}
          onKeyDown={onResizeKey}
          onDoubleClick={() => {
            setSidebarWidth(292);
            saveSidebarWidth(292);
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
      <CommandPalette onAddServer={openAdd} />
      <ShortcutsOverlay />
      <ErDiagram />
      <ImportCsvModal />
      <SchemaDiff />
      <ToastHost />
      <DialogHost />
    </div>
  );
}
