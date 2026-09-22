import { IconAlertTriangle, IconCheck, IconInfoCircle, IconPlus, IconRefresh, IconX } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { backdropV, centeredModalV, MotionButton } from "../../lib/motion";
import { getBackend, isTauri } from "../../ipc/backend";
import { bridgeHealthy } from "../../ipc/http";
import type { ConnEnv, ConnectionConfig, Engine } from "../../ipc/types";
import { promptDialog } from "../../state/dialog";
import { useStore } from "../../state/store";
import "./modal-workspace.css";
import { toast } from "../../state/toast";

const SYSTEM_DBS = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
  "postgres",
  "template0",
  "template1",
]);

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message?: string }).message);
  return String(e);
}

export function ServerModal({ existing, onClose }: { existing?: ConnectionConfig | null; onClose: () => void }) {
  const saveConnection = useStore((s) => s.saveConnection);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const editing = !!existing;
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    const focusable = () => Array.from(
      modal?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  const [engine, setEngine] = useState<Engine>(existing?.engine ?? "sqlite");
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
  const remoteInBrowser = !isTauri();
  const remoteReady = isTauri() || bridgeUp === true;

  useEffect(() => {
    if (!remoteInBrowser) return;
    let alive = true;
    setBridgeUp(null);
    void bridgeHealthy().then((ok) => alive && setBridgeUp(ok));
    return () => {
      alive = false;
    };
  }, [remoteInBrowser]);
  const [name, setName] = useState(existing?.name ?? "");
  const [env, setEnv] = useState<ConnEnv | "">(existing?.env ?? "");
  const [host, setHost] = useState(existing?.host ?? "localhost");
  const [port, setPort] = useState(existing?.port != null ? String(existing.port) : "");
  const [database, setDatabase] = useState(existing?.database ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);

  const defaultPort = engine === "postgres" ? "5432" : engine === "mysql" ? "3306" : "";
  const changeEngine = (next: Engine) => {
    const previousDefault = engine === "postgres" ? "5432" : engine === "mysql" ? "3306" : "";
    setEngine(next);
    setPort((current) => (!current || current === previousDefault ? "" : current));
    setDatabases(null);
    setStatus(null);
  };

  const draftCfg = (db: string): ConnectionConfig => ({
    id: existing?.id ?? `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || `${engine} @ ${host || "local"}`,
    engine,
    host: engine === "sqlite" ? null : host.trim() || "localhost",
    port: engine === "sqlite" ? null : Number(port || defaultPort) || null,
    database: db,
    username: engine === "sqlite" ? null : username.trim() || null,
    env: env || null,
  });

  const testAndList = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const dbs = await getBackend().listDatabases(draftCfg(""), password || null);
      setDatabases(dbs);
      setStatus({ kind: "ok", msg: `Server reachable — ${dbs.length} database${dbs.length === 1 ? "" : "s"}` });
      if (dbs.length && !dbs.includes(database)) {
        setDatabase(dbs.find((d) => !SYSTEM_DBS.has(d)) ?? dbs[0]);
      }
    } catch (e) {
      setDatabases(null);
      setStatus({ kind: "error", msg: errMsg(e) });
    } finally {
      setTesting(false);
    }
  };

  const newDatabase = async () => {
    const dbName = await promptDialog({ title: "Create database", label: "Database name", placeholder: "e.g. hyblock" });
    const safe = dbName?.trim();
    if (!safe) return;
    setTesting(true);
    setStatus(null);
    try {
      await getBackend().createDatabase(draftCfg(""), password || null, safe);
      const dbs = await getBackend().listDatabases(draftCfg(""), password || null);
      setDatabases(dbs);
      setDatabase(safe);
      setStatus({ kind: "ok", msg: `Created "${safe}" — ${dbs.length} databases` });
    } catch (e) {
      setStatus({ kind: "error", msg: errMsg(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const cfg = draftCfg(database.trim());
      await saveConnection(cfg, password || null);
      const opened = await openAndIntrospect(cfg.id);
      if (!opened) {
        const reason = useStore.getState().error?.message;
        setStatus({
          kind: "error",
          msg: `Connection saved, but it could not be opened${reason ? `: ${reason}` : "."}`,
        });
        setBusy(false);
        return;
      }
      toast(`Connected to ${cfg.name}`, "success");
      onClose();
    } catch (e) {
      setStatus({ kind: "error", msg: errMsg(e) });
      setBusy(false);
    }
  };

  const canSave = !!database.trim() && remoteReady && (engine === "sqlite" || !!host.trim());

  return (
    <>
      <motion.div
        className="bud-modal-backdrop"
        variants={backdropV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={onClose}
      />
      <motion.div
        ref={modalRef}
        className="bud-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-dialog-title"
        aria-describedby="connection-dialog-description"
        variants={centeredModalV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bud-modal-head">
          <div>
            <span className="bud-modal-eyebrow">Connection</span>
            <h2 id="connection-dialog-title">{editing ? "Edit data source" : "Add data source"}</h2>
            <p id="connection-dialog-description">{editing ? "Update how OrbitoDB connects to this database." : "Connect a database to your local workspace."}</p>
          </div>
          <button className="bud-modal-close" onClick={onClose} aria-label="Close connection dialog">
            <IconX size={18} stroke={1.7} />
          </button>
        </div>
        <div className="bud-modal-body">
          <label className="bud-field">
            <span>Engine</span>
            <select value={engine} onChange={(e) => changeEngine(e.target.value as Engine)}>
              <option value="sqlite">SQLite (server file)</option>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
            </select>
          </label>
          {remoteInBrowser && (
            <div className={`bud-conn-hint ${bridgeUp === false ? "warn" : bridgeUp ? "ok" : ""}`}>
              {bridgeUp ? <IconCheck size={15} stroke={2} /> : <IconInfoCircle size={15} stroke={1.7} />}
              <span>
                {bridgeUp == null
                  ? "Checking engine server…"
                  : bridgeUp
                    ? "Engine server connected — PostgreSQL & MySQL are ready."
                    : "Engine server offline. Run “npm run bridge” (or “npm run dev:all”) to connect to remote databases."}
              </span>
            </div>
          )}
          <div className="bud-field-row">
            <label className="bud-field grow">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My database" />
            </label>
            <label className="bud-field env">
              <span>Environment</span>
              <select value={env} onChange={(e) => setEnv(e.target.value as ConnEnv | "")}>
                <option value="">None</option>
                <option value="dev">Development</option>
                <option value="staging">Staging</option>
                <option value="prod">Production</option>
              </select>
            </label>
          </div>
          {env === "prod" && (
            <div className="bud-conn-hint warn">
              <IconAlertTriangle size={15} stroke={1.8} />
              <span>Production: writes will ask for an extra confirmation before running.</span>
            </div>
          )}

          {engine !== "sqlite" ? (
            <>
              <div className="bud-field-row">
                <label className="bud-field">
                  <span>Host</span>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="e.g. postgres, mysql, host.docker.internal" />
                </label>
                <label className="bud-field port">
                  <span>Port</span>
                  <input value={port} onChange={(e) => setPort(e.target.value)} placeholder={defaultPort} />
                </label>
              </div>
              {!isTauri() && /^(localhost|127\.0\.0\.1|::1)$/i.test(host.trim()) && (
                <div className="bud-conn-hint">
                  <IconInfoCircle size={15} stroke={1.7} />
                  <span>
                    <code>localhost</code> connects to a database on your own computer (even when OrbitoDB runs in
                    Docker). If it still can't connect, that database only allows local connections — let it accept
                    other hosts (bind to <code>0.0.0.0</code>), or run OrbitoDB outside Docker.
                  </span>
                </div>
              )}
              <div className="bud-field-row">
                <label className="bud-field">
                  <span>Username</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} />
                </label>
                <label className="bud-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={password}
                    placeholder={editing ? "•••••• (unchanged)" : ""}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </div>

              <button className="bud-test-btn" onClick={testAndList} disabled={testing || !remoteReady || !host.trim()}>
                <IconRefresh size={15} stroke={1.7} className={testing ? "bud-spin" : ""} />
                {testing ? "Connecting…" : "Test connection & list databases"}
              </button>
              <label className="bud-field">
                <span>Database</span>
                <div className="bud-db-row">
                  {databases ? (
                    <select value={database} onChange={(e) => setDatabase(e.target.value)}>
                      {!databases.includes(database) && database && <option value={database}>{database}</option>}
                      {databases.map((d) => (
                        <option key={d} value={d}>
                          {d}
                          {SYSTEM_DBS.has(d) ? "  (system)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      placeholder="test the connection to list, or type a name"
                    />
                  )}
                  <button className="bud-db-new" onClick={newDatabase} disabled={testing || !remoteReady || !host.trim()} title="Create a new database">
                    <IconPlus size={15} stroke={2} /> New
                  </button>
                </div>
              </label>
            </>
          ) : (
            <label className="bud-field">
              <span>Database name</span>
              <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="e.g. analytics" />
              <span className="bud-field-hint">
                A real SQLite database stored in a file on the server — shared across browsers, tabs, and ports. Type an
                existing name to open it, or a new name to create it.
              </span>
            </label>
          )}
          {status && (
            <div className={`bud-conn-status ${status.kind}`} role="status" aria-live="polite">
              {status.kind === "ok" ? <IconCheck size={15} stroke={2} /> : <IconAlertTriangle size={15} stroke={1.8} />}
              <span>{status.msg}</span>
            </div>
          )}
        </div>
        <div className="bud-modal-actions">
          <MotionButton className="bud-modal-cancel" onClick={onClose}>
            Cancel
          </MotionButton>
          <MotionButton className="bud-modal-save" onClick={save} disabled={busy || !canSave}>
            {busy ? "Connecting…" : editing ? "Save changes" : "Add data source"}
          </MotionButton>
        </div>
      </motion.div>
    </>
  );
}
