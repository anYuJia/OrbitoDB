import { IconLock, IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import { useStore } from "../../state/store";

export function StatusBar() {
  const conn = useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId));
  const connecting = useStore((s) => s.connectingConnectionId != null);
  const loadingTables = useStore((s) => s.loadingTables);
  const dataResult = useStore((s) => s.result);
  const queryResult = useStore((s) => s.editorResults[s.activeEditorId] ?? null);
  const view = useStore((s) => s.view);
  const topView = useStore((s) => s.topView);
  const loadingResult = useStore((s) => s.loadingResult);
  const running = useStore((s) => s.running);
  const selection = useStore((s) => s.selection);
  const readOnly = useStore((s) => s.readOnlyConns.includes(s.activeConnectionId ?? ""));
  const txnDirty = useStore((s) => s.txnDirty);
  const rollbackTxn = useStore((s) => s.rollbackTxn);
  const commitTxn = useStore((s) => s.commitTxn);

  const result = topView === "data" ? (view === "data" ? dataResult : view === "sql" ? queryResult : null) : null;
  const rows = result?.rows.length ?? 0;
  const sel = topView === "data" && view === "data" ? selection.length : 0;
  const secs = result ? (result.elapsedMs / 1000).toFixed(3) : "0.000";

  return (
    <footer className="bud-statusbar" aria-live="polite">
      <div className="bud-status-l">
        {conn ? (
          <span className="bud-status-conn">
            <IconPlugConnected size={13} stroke={1.8} />
            <span className="bud-status-engine">{conn.engine}</span>
            {connecting ? `Connecting · ${conn.name}` : conn.name}
          </span>
        ) : (
          <span className="bud-status-conn off">
            <IconPlugConnectedX size={13} stroke={1.8} />
            Not connected
          </span>
        )}
        {conn?.env && (
          <span className={`bud-status-env ${conn.env}`} title={`${conn.env} environment`}>
            {conn.env === "prod" ? "PRODUCTION" : conn.env.toUpperCase()}
          </span>
        )}
        {readOnly && (
          <span className="bud-status-ro" title="This connection is read-only">
            <IconLock size={12} stroke={1.9} /> Read-only
          </span>
        )}
      </div>
      <div className="bud-status-r">
        {txnDirty && (
          <span className="bud-status-txn" title="Uncommitted transaction">
            <button onClick={() => void commitTxn()}>Commit</button>
            <button onClick={() => void rollbackTxn()}>Rollback</button>
            ● Uncommitted
          </span>
        )}
        {(connecting || loadingTables || loadingResult || running) && (
          <span className="bud-status-item">
            {running ? "Running query…" : connecting || loadingTables ? "Loading schema…" : "Loading rows…"}
          </span>
        )}
        {sel > 0 && <span className="bud-status-item accent">{sel} selected</span>}
        {result && <span className="bud-status-item">{rows.toLocaleString()} rows</span>}
        {result && <span className="bud-status-item">{secs}s</span>}
        <span className="bud-status-ready"><i /> {connecting || loadingTables || loadingResult || running ? "Working" : "Ready"}</span>
      </div>
    </footer>
  );
}
