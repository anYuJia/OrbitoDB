import {
  IconAlertTriangle,
  IconCheck,
  IconDatabase,
  IconFileDatabase,
  IconInfoCircle,
  IconPlus,
  IconRefresh,
  IconServer,
  IconX,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { ConnEnv, ConnectionConfig, Engine } from "../../ipc/types";
import { getBackend, isTauri } from "../../ipc/backend";
import { bridgeHealthy } from "../../ipc/http";
import { backdropV, centeredModalV, MotionButton } from "../../lib/motion";
import { promptDialog } from "../../state/dialog";
import { useStore } from "../../state/store";
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

function engineLabel(engine: Engine): string {
  if (engine === "postgres") return "PostgreSQL";
  if (engine === "mysql") return "MySQL / MariaDB";
  return "SQLite";
}

function defaultPortFor(engine: Engine): string {
  if (engine === "postgres") return "5432";
  if (engine === "mysql") return "3306";
  return "";
}

export function ServerModal({ existing, onClose }: { existing?: ConnectionConfig | null; onClose: () => void }) {
  const saveConnection = useStore((s) => s.saveConnection);
  const openAndIntrospect = useStore((s) => s.openAndIntrospect);
  const editing = !!existing;

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
  const [port, setPort] = useState(existing?.port != null ? String(existing.port) : defaultPortFor(existing?.engine ?? "sqlite"));
  const [database, setDatabase] = useState(existing?.database ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);

  const defaultPort = defaultPortFor(engine);

  const chooseEngine = (next: Engine) => {
    if (next === engine) return;
    setEngine(next);
    setDatabases(null);
    setStatus(null);
    setDatabase("");
    setPort(defaultPortFor(next));
    if (next === "sqlite") {
      setHost("localhost");
      setUsername("");
      setPassword("");
    }
  };

  const draftCfg = (db: string): ConnectionConfig => ({
    id: existing?.id ?? `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || `${engineLabel(engine)} · ${db || host || "local"}`,
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
      setStatus({ kind: "ok", msg: `Connected · ${dbs.length} database${dbs.length === 1 ? "" : "s"} available` });
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
    const dbName = await promptDialog({ title: "Create database", label: "Database name", placeholder: "e.g. analytics" });
    const safe = dbName?.trim();
    if (!safe) return;
    setTesting(true);
    setStatus(null);
    try {
      await getBackend().createDatabase(draftCfg(""), password || null, safe);
      const dbs = await getBackend().listDatabases(draftCfg(""), password || null);
      setDatabases(dbs);
      setDatabase(safe);
      setStatus({ kind: "ok", msg: `Created "${safe}"` });
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
      await openAndIntrospect(cfg.id);
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
        className="odb-connection-modal"
        variants={centeredModalV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="odb-connection-head">
          <div>
            <span>{editing ? "Connection settings" : "New connection"}</span>
            <h2>{editing ? existing?.name : "Connect a database"}</h2>
            <p>Connections and credentials stay local to OrbitoDB.</p>
          </div>
          <button className="odb-modal-close" onClick={onClose} title="Close">
            <IconX size={16} stroke={1.8} />
          </button>
        </header>

        <div className="odb-connection-body">
          <section className="odb-connection-section">
            <div className="odb-section-label">
              <span>01</span>
              <div>
                <b>Database engine</b>
                <small>Choose the driver for this connection.</small>
              </div>
            </div>
            <div className="odb-engine-grid">
              <button className={engine === "sqlite" ? "on" : ""} onClick={() => chooseEngine("sqlite")}>
                <IconFileDatabase size={19} stroke={1.6} />
                <span>
                  <b>SQLite</b>
                  <small>Local database file</small>
                </span>
              </button>
              <button className={engine === "postgres" ? "on" : ""} onClick={() => chooseEngine("postgres")}>
                <IconDatabase size={19} stroke={1.6} />
                <span>
                  <b>PostgreSQL</b>
                  <small>5432 by default</small>
                </span>
              </button>
              <button className={engine === "mysql" ? "on" : ""} onClick={() => chooseEngine("mysql")}>
                <IconServer size={19} stroke={1.6} />
                <span>
                  <b>MySQL</b>
                  <small>MySQL / MariaDB</small>
                </span>
              </button>
            </div>
          </section>

          <section className="odb-connection-section">
            <div className="odb-section-label">
              <span>02</span>
              <div>
                <b>Profile</b>
                <small>Name the connection and optionally mark its environment.</small>
              </div>
            </div>
            <div className="odb-form-grid profile">
              <label className="odb-form-field grow">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${engineLabel(engine)} connection`} />
              </label>
              <label className="odb-form-field env">
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
              <div className="odb-connection-alert warn">
                <IconAlertTriangle size={15} stroke={1.8} />
                <span>Production guard enabled. Write queries require an extra confirmation.</span>
              </div>
            )}
          </section>

          <section className="odb-connection-section">
            <div className="odb-section-label">
              <span>03</span>
              <div>
                <b>{engine === "sqlite" ? "Database" : "Server"}</b>
                <small>
                  {engine === "sqlite"
                    ? "Choose the local database name."
                    : "Enter server credentials, test the connection, then choose a database."}
                </small>
              </div>
            </div>

            {remoteInBrowser && engine !== "sqlite" && (
              <div className={`odb-connection-alert ${bridgeUp === false ? "warn" : bridgeUp ? "ok" : ""}`}>
                {bridgeUp ? <IconCheck size={15} stroke={2} /> : <IconInfoCircle size={15} stroke={1.7} />}
                <span>
                  {bridgeUp == null
                    ? "Checking local bridge…"
                    : bridgeUp
                      ? "Local bridge connected."
                      : "Local bridge is offline. Start it before connecting to PostgreSQL or MySQL from the browser build."}
                </span>
              </div>
            )}

            {engine === "sqlite" ? (
              <label className="odb-form-field">
                <span>Database name</span>
                <input
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="analytics"
                  autoFocus={!editing}
                />
                <small>Open an existing local SQLite database or enter a new name to create one.</small>
              </label>
            ) : (
              <>
                <div className="odb-form-grid host">
                  <label className="odb-form-field grow">
                    <span>Host</span>
                    <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
                  </label>
                  <label className="odb-form-field port">
                    <span>Port</span>
                    <input
                      inputMode="numeric"
                      value={port}
                      onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                      placeholder={defaultPort}
                    />
                  </label>
                </div>
                <div className="odb-form-grid credentials">
                  <label className="odb-form-field">
                    <span>Username</span>
                    <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
                  </label>
                  <label className="odb-form-field">
                    <span>Password</span>
                    <input
                      type="password"
                      value={password}
                      placeholder={editing ? "Leave blank to keep current password" : ""}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                </div>

                <div className="odb-test-row">
                  <button className="odb-test-btn" onClick={() => void testAndList()} disabled={testing || !remoteReady || !host.trim()}>
                    <IconRefresh size={14} stroke={1.8} className={testing ? "bud-spin" : ""} />
                    {testing ? "Testing…" : "Test connection"}
                  </button>
                  {status && (
                    <div className={`odb-inline-status ${status.kind}`}>
                      {status.kind === "ok" ? <IconCheck size={14} stroke={2} /> : <IconAlertTriangle size={14} stroke={1.8} />}
                      <span>{status.msg}</span>
                    </div>
                  )}
                </div>

                <label className="odb-form-field">
                  <span>Database</span>
                  <div className="odb-database-picker">
                    {databases ? (
                      <select value={database} onChange={(e) => setDatabase(e.target.value)}>
                        {!databases.includes(database) && database && <option value={database}>{database}</option>}
                        {databases.map((d) => (
                          <option key={d} value={d}>
                            {d}{SYSTEM_DBS.has(d) ? " · system" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={database}
                        onChange={(e) => setDatabase(e.target.value)}
                        placeholder="Test connection to discover databases, or type a name"
                      />
                    )}
                    <button onClick={() => void newDatabase()} disabled={testing || !remoteReady} title="Create database">
                      <IconPlus size={14} stroke={2} />
                      New
                    </button>
                  </div>
                </label>
              </>
            )}
          </section>
        </div>

        <footer className="odb-connection-footer">
          <span>{editing ? "Saving keeps the existing password when the password field is blank." : "No OrbitoDB account required."}</span>
          <div>
            <MotionButton className="odb-modal-secondary" onClick={onClose}>Cancel</MotionButton>
            <MotionButton className="odb-modal-primary" onClick={() => void save()} disabled={busy || !canSave}>
              {busy ? "Connecting…" : editing ? "Save & reconnect" : "Connect"}
            </MotionButton>
          </div>
        </footer>
      </motion.div>
    </>
  );
}
