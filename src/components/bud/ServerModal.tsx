import {
  IconAlertTriangle,
  IconBrandMysql,
  IconCheck,
  IconDatabase,
  IconEye,
  IconEyeOff,
  IconFileDatabase,
  IconInfoCircle,
  IconPlus,
  IconRefresh,
  IconServer,
  IconShieldLock,
  IconX,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBackend, isTauri } from "../../ipc/backend";
import { bridgeHealthy } from "../../ipc/http";
import type { ConnEnv, ConnectionConfig, Engine } from "../../ipc/types";
import {
  connectionEndpoint,
  DEFAULT_PORTS,
  managedSqliteNameError,
  parseConnectionPort,
  serverDatabaseNameError,
} from "../../lib/connection";
import { backdropV, centeredModalV, MotionButton } from "../../lib/motion";
import { confirmDialog, useDialog } from "../../state/dialog";
import { useStore } from "../../state/store";
import { toast } from "../../state/toast";
import "./modal-workspace.css";
import "./connection-workspace.css";

const SYSTEM_DBS = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
  "postgres",
  "template0",
  "template1",
]);

const ENGINE_OPTIONS: Array<{ engine: Engine; label: string; detail: string }> = [
  { engine: "sqlite", label: "SQLite", detail: "Managed local file" },
  { engine: "postgres", label: "PostgreSQL", detail: "Server · port 5432" },
  { engine: "mysql", label: "MySQL / MariaDB", detail: "Server · port 3306" },
];

function errMsg(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message);
  }
  return String(error);
}

function databaseStem(value: string): string {
  const leaf = value.split(/[\\/]/).pop() ?? value;
  return leaf.replace(/\.sqlite$/i, "").toLocaleLowerCase();
}

function engineIcon(engine: Engine) {
  if (engine === "sqlite") return <IconFileDatabase size={19} stroke={1.65} />;
  if (engine === "mysql") return <IconBrandMysql size={19} stroke={1.65} />;
  return <IconDatabase size={19} stroke={1.65} />;
}

interface FormSnapshot {
  database: string;
  engine: Engine;
  env: ConnEnv | "";
  host: string;
  name: string;
  newDatabaseName: string;
  password: string;
  port: string;
  username: string;
}

function fingerprint(snapshot: FormSnapshot): string {
  return JSON.stringify(snapshot);
}

export function ServerModal({ existing, onClose }: { existing?: ConnectionConfig | null; onClose: () => void }) {
  const editing = !!existing;
  const saveConnection = useStore((state) => state.saveConnection);
  const openAndIntrospect = useStore((state) => state.openAndIntrospect);
  const connections = useStore((state) => state.connections);

  const [engine, setEngine] = useState<Engine>(existing?.engine ?? "sqlite");
  const [name, setName] = useState(existing?.name ?? "");
  const [env, setEnv] = useState<ConnEnv | "">(existing?.env ?? "");
  const [host, setHost] = useState(existing?.host ?? "localhost");
  const [port, setPort] = useState(existing?.port != null ? String(existing.port) : "");
  const [database, setDatabase] = useState(existing?.database ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [testedSignature, setTestedSignature] = useState<string | null>(null);
  const [creatingDatabase, setCreatingDatabase] = useState(false);
  const [newDatabaseName, setNewDatabaseName] = useState("");
  const [testing, setTesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const requestCloseRef = useRef<() => Promise<void>>(async () => {});
  const connectionIdRef = useRef(
    existing?.id ?? `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  );
  const remoteInBrowser = !isTauri();
  const remoteReady = isTauri() || bridgeUp === true;

  const currentSnapshot = useMemo<FormSnapshot>(() => ({
    database,
    engine,
    env,
    host,
    name,
    newDatabaseName,
    password,
    port,
    username,
  }), [database, engine, env, host, name, newDatabaseName, password, port, username]);
  const currentFingerprint = fingerprint(currentSnapshot);
  const [savedFingerprint, setSavedFingerprint] = useState(() => fingerprint({
    database: existing?.database ?? "",
    engine: existing?.engine ?? "sqlite",
    env: existing?.env ?? "",
    host: existing?.host ?? "localhost",
    name: existing?.name ?? "",
    newDatabaseName: "",
    password: "",
    port: existing?.port != null ? String(existing.port) : "",
    username: existing?.username ?? "",
  }));
  const dirty = currentFingerprint !== savedFingerprint;

  const parsedPort = parseConnectionPort(engine, port);
  const remoteEngine = engine !== "sqlite";
  const defaultPort = remoteEngine ? String(DEFAULT_PORTS[engine]) : "";
  const verificationSignature = JSON.stringify([
    engine,
    host.trim(),
    parsedPort.value,
    username.trim(),
    password,
  ]);
  const sqliteNameError = engine === "sqlite" && !editing && database
    ? managedSqliteNameError(database)
    : null;
  const duplicateSqlite = engine === "sqlite" && !editing && !!database.trim() && connections.some(
    (connection) => connection.engine === "sqlite" && databaseStem(connection.database) === database.trim().toLocaleLowerCase(),
  );
  const newDatabaseError = newDatabaseName ? serverDatabaseNameError(newDatabaseName) : null;
  const canReachServer = remoteEngine && remoteReady && !!host.trim() && !parsedPort.error;
  const canSave = remoteReady && !!database.trim() && (
    remoteEngine
      ? !!host.trim() && !parsedPort.error
      : !sqliteNameError && !duplicateSqlite
  );
  const endpoint = remoteEngine && parsedPort.error
    ? `${host.trim() || "localhost"}:${port.trim() || defaultPort}${database.trim() ? ` / ${database.trim()}` : ""}`
    : connectionEndpoint(engine, host, parsedPort.value, database);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const checkBridge = useCallback(async () => {
    if (!remoteInBrowser) return;
    setBridgeUp(null);
    setBridgeUp(await bridgeHealthy());
  }, [remoteInBrowser]);

  useEffect(() => {
    void checkBridge();
  }, [checkBridge]);

  useEffect(() => {
    if (!testedSignature || testedSignature === verificationSignature) return;
    setTestedSignature(null);
    setDatabases(null);
    setStatus(null);
  }, [testedSignature, verificationSignature]);

  const closeNow = useCallback(() => onCloseRef.current(), []);
  const requestClose = useCallback(async () => {
    if (busy || testing || creating) return;
    if (dirty && !(await confirmDialog({
      title: "Discard connection changes?",
      message: "The connection details entered here have not been saved.",
      confirmLabel: "Discard changes",
      danger: true,
    }))) return;
    closeNow();
  }, [busy, closeNow, creating, dirty, testing]);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const frame = window.requestAnimationFrame(() => (
      modalRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0]
    )?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (useDialog.getState().current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  const changeEngine = (next: Engine) => {
    const previousDefault = engine === "sqlite" ? "" : String(DEFAULT_PORTS[engine]);
    setEngine(next);
    setPort((current) => (!current || current === previousDefault ? "" : current));
    setDatabases(null);
    setStatus(null);
    setTestedSignature(null);
    setCreatingDatabase(false);
    setNewDatabaseName("");
  };

  const draftCfg = (selectedDatabase: string): ConnectionConfig => {
    const fallbackName = engine === "sqlite"
      ? selectedDatabase || "Local database"
      : `${selectedDatabase || ENGINE_OPTIONS.find((option) => option.engine === engine)?.label} @ ${host.trim() || "localhost"}`;
    return {
      id: connectionIdRef.current,
      name: name.trim() || fallbackName,
      engine,
      host: engine === "sqlite" ? null : host.trim() || "localhost",
      port: engine === "sqlite" ? null : parsedPort.value,
      database: selectedDatabase,
      username: engine === "sqlite" ? null : username.trim() || null,
      env: env || null,
    };
  };

  const testAndList = async () => {
    if (!canReachServer) return;
    setTesting(true);
    setStatus(null);
    try {
      const dbs = await getBackend().listDatabases(draftCfg(""), password || null);
      setDatabases(dbs);
      setTestedSignature(verificationSignature);
      setStatus({ kind: "ok", msg: `Server verified · ${dbs.length.toLocaleString()} database${dbs.length === 1 ? "" : "s"} available` });
      if (dbs.length && !dbs.includes(database)) {
        setDatabase(dbs.find((item) => !SYSTEM_DBS.has(item)) ?? dbs[0]);
      }
    } catch (error) {
      setDatabases(null);
      setTestedSignature(verificationSignature);
      setStatus({ kind: "error", msg: errMsg(error) });
    } finally {
      setTesting(false);
    }
  };

  const createDatabase = async () => {
    const nextName = newDatabaseName.trim();
    if (!canReachServer || serverDatabaseNameError(nextName)) return;
    setCreating(true);
    setStatus(null);
    try {
      await getBackend().createDatabase(draftCfg(""), password || null, nextName);
      const dbs = await getBackend().listDatabases(draftCfg(""), password || null);
      setDatabases(dbs);
      setDatabase(nextName);
      setNewDatabaseName("");
      setCreatingDatabase(false);
      setTestedSignature(verificationSignature);
      setStatus({ kind: "ok", msg: `Created and selected ${nextName}` });
    } catch (error) {
      setTestedSignature(verificationSignature);
      setStatus({ kind: "error", msg: errMsg(error) });
    } finally {
      setCreating(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setStatus(null);
    try {
      let cfg: ConnectionConfig;
      if (!editing && engine === "sqlite" && isTauri()) {
        const managed = await getBackend().createLocalDatabase(database.trim());
        cfg = {
          ...managed,
          name: name.trim() || database.trim(),
          env: env || null,
        };
        await saveConnection(cfg, null);
      } else {
        cfg = draftCfg(database.trim());
        await saveConnection(cfg, password || null);
      }
      setSavedFingerprint(currentFingerprint);
      const opened = await openAndIntrospect(cfg.id);
      if (!opened) {
        const reason = useStore.getState().error?.message;
        setStatus({
          kind: "error",
          msg: `Connection saved, but it could not be opened${reason ? `: ${reason}` : "."}`,
        });
        return;
      }
      toast(`Connected to ${cfg.name}`, "success");
      closeNow();
    } catch (error) {
      setStatus({ kind: "error", msg: errMsg(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <motion.div
        className="bud-modal-backdrop"
        variants={backdropV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={() => void requestClose()}
      />
      <motion.div
        ref={modalRef}
        className="bud-modal odb-connection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-dialog-title"
        aria-describedby="connection-dialog-description"
        aria-busy={busy || testing || creating}
        variants={centeredModalV}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="bud-modal-head odb-connection-head">
          <div>
            <span className="bud-modal-eyebrow">Database connection</span>
            <h2 id="connection-dialog-title"><IconServer size={18} stroke={1.7} /> {editing ? "Edit data source" : "Connect a data source"}</h2>
            <p id="connection-dialog-description">Configure the engine, verify access, and open the workspace.</p>
          </div>
          <button className="bud-modal-close" onClick={() => void requestClose()} aria-label="Close connection dialog" disabled={busy || testing || creating}>
            <IconX size={18} stroke={1.7} />
          </button>
        </header>

        <div className="bud-modal-body odb-connection-body">
          <section className="odb-connection-section" aria-labelledby="connection-engine-title">
            <div className="odb-connection-section-head">
              <div><span>Engine</span><h3 id="connection-engine-title">Choose how OrbitoDB should connect</h3></div>
              <span>Step 1 of 3</span>
            </div>
            <div className="odb-engine-options" role="group" aria-label="Database engine">
              {ENGINE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.engine}
                  className={engine === option.engine ? "is-selected" : ""}
                  aria-pressed={engine === option.engine}
                  data-autofocus={engine === option.engine ? "true" : undefined}
                  onClick={() => changeEngine(option.engine)}
                  disabled={busy || testing || creating}
                >
                  <span>{engineIcon(option.engine)}</span>
                  <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  {engine === option.engine && <IconCheck size={13} stroke={2.2} />}
                </button>
              ))}
            </div>

            {remoteInBrowser && (
              <div className={`odb-engine-bridge ${bridgeUp === false ? "is-offline" : bridgeUp ? "is-ready" : ""}`} role="status">
                {bridgeUp ? <IconCheck size={14} stroke={2} /> : bridgeUp === false ? <IconAlertTriangle size={14} stroke={1.8} /> : <IconRefresh size={14} className="bud-spin" />}
                <span>
                  <strong>{bridgeUp == null ? "Checking local engine" : bridgeUp ? "Local engine ready" : "Local engine offline"}</strong>
                  {bridgeUp == null ? "Verifying the database bridge…" : bridgeUp ? "SQLite, PostgreSQL, and MySQL connections are available." : "Start the bridge to connect or create local databases."}
                </span>
                {bridgeUp === false && <button type="button" onClick={() => void checkBridge()}>Retry</button>}
              </div>
            )}
          </section>

          <section className="odb-connection-section" aria-labelledby="connection-profile-title">
            <div className="odb-connection-section-head">
              <div><span>Profile</span><h3 id="connection-profile-title">Identify this connection</h3></div>
              <span>Step 2 of 3</span>
            </div>
            <div className="odb-connection-grid profile">
              <label className="bud-field">
                <span>Display name <small>Optional</small></span>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder={engine === "sqlite" ? "e.g. Product analytics" : "e.g. Production warehouse"} disabled={busy} />
              </label>
              <label className="bud-field">
                <span>Environment</span>
                <select value={env} onChange={(event) => setEnv(event.target.value as ConnEnv | "")} disabled={busy}>
                  <option value="">Unspecified</option>
                  <option value="dev">Development</option>
                  <option value="staging">Staging</option>
                  <option value="prod">Production</option>
                </select>
              </label>
            </div>
            {env === "prod" && (
              <div className="odb-connection-callout warning" role="status">
                <IconAlertTriangle size={15} stroke={1.8} />
                <span><strong>Production safeguards enabled</strong>Write operations will require an additional confirmation.</span>
              </div>
            )}
          </section>

          <section className="odb-connection-section" aria-labelledby="connection-details-title">
            <div className="odb-connection-section-head">
              <div><span>Configuration</span><h3 id="connection-details-title">{remoteEngine ? "Connect and select a database" : "Choose a managed database file"}</h3></div>
              <span>Step 3 of 3</span>
            </div>

            {remoteEngine ? (
              <div className="odb-remote-fields">
                <div className="odb-connection-grid endpoint">
                  <label className="bud-field">
                    <span>Host</span>
                    <input value={host} onChange={(event) => setHost(event.target.value)} placeholder="db.example.internal" disabled={busy || testing || creating} />
                  </label>
                  <label className={`bud-field ${parsedPort.error ? "has-error" : ""}`}>
                    <span>Port</span>
                    <input
                      inputMode="numeric"
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                      placeholder={defaultPort}
                      aria-invalid={!!parsedPort.error}
                      aria-describedby={parsedPort.error ? "connection-port-error" : undefined}
                      disabled={busy || testing || creating}
                    />
                    {parsedPort.error && <small id="connection-port-error" className="odb-field-error">{parsedPort.error}</small>}
                  </label>
                </div>

                {!isTauri() && /^(localhost|127\.0\.0\.1|::1)$/i.test(host.trim()) && (
                  <details className="odb-localhost-help">
                    <summary><IconInfoCircle size={14} stroke={1.8} /> Connecting to localhost from Docker</summary>
                    <p>OrbitoDB routes localhost to your computer. If access still fails, allow the database to accept non-loopback clients or run OrbitoDB outside Docker.</p>
                  </details>
                )}

                <div className="odb-connection-grid credentials">
                  <label className="bud-field">
                    <span>Username <small>Optional</small></span>
                    <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" disabled={busy || testing || creating} />
                  </label>
                  <div className="bud-field">
                    <label htmlFor="connection-password">Password <small>{editing ? "Leave blank to keep saved secret" : "Optional"}</small></label>
                    <span className="odb-password-field">
                      <input
                        id="connection-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                        placeholder={editing ? "Saved password unchanged" : "Password"}
                        disabled={busy || testing || creating}
                      />
                      <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} disabled={busy || testing || creating}>
                        {showPassword ? <IconEyeOff size={15} stroke={1.7} /> : <IconEye size={15} stroke={1.7} />}
                      </button>
                    </span>
                  </div>
                </div>

                <div className="odb-database-picker">
                  <label className="bud-field">
                    <span>Database</span>
                    {databases ? (
                      <select value={database} onChange={(event) => setDatabase(event.target.value)} disabled={busy || testing || creating}>
                        {!databases.includes(database) && database && <option value={database}>{database}</option>}
                        {databases.map((item) => <option key={item} value={item}>{item}{SYSTEM_DBS.has(item) ? " · system" : ""}</option>)}
                      </select>
                    ) : (
                      <input value={database} onChange={(event) => setDatabase(event.target.value)} placeholder="e.g. analytics" disabled={busy || testing || creating} />
                    )}
                  </label>
                  <div className="odb-database-actions">
                    <button type="button" className="odb-verify-button" onClick={() => void testAndList()} disabled={!canReachServer || testing || busy || creating}>
                      <IconRefresh size={14} stroke={1.8} className={testing ? "bud-spin" : ""} />
                      {testing ? "Verifying…" : testedSignature === verificationSignature && status?.kind === "ok" ? "Verified" : "Verify & discover"}
                    </button>
                    <button type="button" onClick={() => setCreatingDatabase((open) => !open)} disabled={!canReachServer || testing || busy || creating}>
                      <IconPlus size={14} stroke={1.9} /> New database
                    </button>
                  </div>
                </div>

                {creatingDatabase && (
                  <div className="odb-create-database">
                    <div>
                      <strong>Create on this server</strong>
                      <span>The new database will be selected after creation.</span>
                    </div>
                    <label className={newDatabaseError ? "has-error" : ""}>
                      <input
                        value={newDatabaseName}
                        onChange={(event) => setNewDatabaseName(event.target.value)}
                        placeholder="database_name"
                        aria-label="New database name"
                        aria-invalid={!!newDatabaseError}
                        disabled={creating}
                      />
                      {newDatabaseError && <small>{newDatabaseError}</small>}
                    </label>
                    <button type="button" onClick={() => { setCreatingDatabase(false); setNewDatabaseName(""); }} disabled={creating}>Cancel</button>
                    <button type="button" className="primary" onClick={() => void createDatabase()} disabled={creating || !newDatabaseName.trim() || !!newDatabaseError}>
                      {creating ? "Creating…" : "Create"}
                    </button>
                  </div>
                )}

                {editing && !password && (
                  <div className="odb-connection-inline-note"><IconShieldLock size={14} stroke={1.7} /> Enter the password again only if you need to re-verify; saving leaves the stored secret unchanged.</div>
                )}
              </div>
            ) : (
              <div className="odb-sqlite-fields">
                <label className={`bud-field ${sqliteNameError || duplicateSqlite ? "has-error" : ""}`}>
                  <span>{editing && isTauri() ? "Database file" : "Database name"}</span>
                  <input
                    value={database}
                    onChange={(event) => setDatabase(event.target.value)}
                    placeholder={editing && isTauri() ? "/path/to/database.sqlite" : "analytics"}
                    aria-invalid={!!sqliteNameError || duplicateSqlite}
                    aria-describedby={sqliteNameError || duplicateSqlite ? "sqlite-name-error" : "sqlite-name-help"}
                    disabled={busy}
                  />
                  {(sqliteNameError || duplicateSqlite) ? (
                    <small id="sqlite-name-error" className="odb-field-error">{sqliteNameError ?? "A saved connection already uses this managed database."}</small>
                  ) : (
                    <small id="sqlite-name-help">
                      {editing && isTauri()
                        ? "Use an existing SQLite path or keep the current managed file."
                        : remoteInBrowser
                          ? "Stored by the local engine bridge and shared across browser sessions."
                          : "Created in OrbitoDB’s managed application data folder."}
                    </small>
                  )}
                </label>
                <div className="odb-sqlite-summary">
                  <IconFileDatabase size={17} stroke={1.7} />
                  <span>
                    <strong>Managed SQLite</strong>
                    {sqliteNameError || duplicateSqlite
                      ? "Fix the database name to continue"
                      : database.trim() ? `${databaseStem(database)}.sqlite` : "Enter a name to preview the file"}
                  </span>
                </div>
              </div>
            )}

            {status && (
              <div className={`odb-connection-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"} aria-live="polite">
                {status.kind === "ok" ? <IconCheck size={15} stroke={2} /> : <IconAlertTriangle size={15} stroke={1.8} />}
                <span>{status.msg}</span>
              </div>
            )}
          </section>
        </div>

        <footer className="bud-modal-actions odb-connection-actions">
          <div className="odb-connection-endpoint">
            {remoteEngine ? <IconServer size={14} stroke={1.7} /> : <IconFileDatabase size={14} stroke={1.7} />}
            <span><small>{remoteEngine ? "Endpoint" : "Database"}</small><strong title={endpoint}>{endpoint}</strong></span>
          </div>
          <MotionButton className="bud-modal-cancel" onClick={() => void requestClose()} disabled={busy || testing || creating}>Cancel</MotionButton>
          <MotionButton className="bud-modal-save" onClick={() => void save()} disabled={busy || testing || creating || !canSave} title={!remoteReady ? "Start the local engine first" : undefined}>
            {busy ? "Connecting…" : editing ? "Save and reconnect" : "Connect data source"}
          </MotionButton>
        </footer>
      </motion.div>
    </>
  );
}
