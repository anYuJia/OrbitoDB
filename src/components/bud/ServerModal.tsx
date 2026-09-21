import {
  IconAlertTriangle,
  IconCheck,
  IconDatabase,
  IconFileDatabase,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
  IconLink,
  IconPlus,
  IconRefresh,
  IconServer,
  IconX,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { ConnEnv, ConnectionConfig, Engine, SshAuth, TlsMode } from "../../ipc/types";
import { getBackend, isTauri } from "../../ipc/backend";
import { bridgeHealthy } from "../../ipc/http";
import { backdropV, centeredModalV, MotionButton } from "../../lib/motion";
import { translate, useI18n } from "../../lib/i18n";
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


function parseTlsMode(engine: Exclude<Engine, "sqlite">, url: URL): TlsMode {
  const raw =
    engine === "postgres"
      ? url.searchParams.get("sslmode")
      : url.searchParams.get("ssl-mode");
  if (!raw) return "disable";

  const value = raw.trim().toLowerCase().replace(/_/g, "-");
  if (engine === "postgres") {
    if (["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(value)) {
      return value as TlsMode;
    }
    throw new Error(`Unsupported PostgreSQL sslmode: ${raw}`);
  }

  if (value === "disabled" || value === "disable") return "disable";
  if (value === "preferred" || value === "prefer") return "prefer";
  if (value === "required" || value === "require") return "require";
  if (value === "verify-ca") return "verify-ca";
  if (value === "verify-identity" || value === "verify-full") return "verify-full";
  throw new Error(`Unsupported MySQL ssl-mode: ${raw}`);
}

function parseConnectionUrl(raw: string): {
  engine: Exclude<Engine, "sqlite">;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  tlsMode: TlsMode;
  tlsCaPath: string;
  ignoredParams: string[];
} {
  const value = raw.trim();
  if (!value) throw new Error(translate("connection.urlPaste"));

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(translate("connection.urlInvalid"));
  }

  const protocol = url.protocol.toLowerCase();
  const engine: Exclude<Engine, "sqlite"> =
    protocol === "postgres:" || protocol === "postgresql:"
      ? "postgres"
      : protocol === "mysql:" || protocol === "mariadb:"
        ? "mysql"
        : (() => {
            throw new Error(translate("connection.urlScheme"));
          })();

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!url.hostname) throw new Error(translate("connection.urlMissingHost"));
  if (!database) throw new Error(translate("connection.urlMissingDatabase"));

  const tlsMode = parseTlsMode(engine, url);
  const tlsCaPath =
    engine === "postgres"
      ? url.searchParams.get("sslrootcert") ?? ""
      : url.searchParams.get("ssl-ca") ?? "";
  const consumed = new Set(
    engine === "postgres"
      ? ["sslmode", "sslrootcert"]
      : ["ssl-mode", "ssl-ca"],
  );
  const ignoredParams = [...url.searchParams.keys()].filter((key) => !consumed.has(key));

  return {
    engine,
    host: url.hostname,
    port: url.port || defaultPortFor(engine),
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    tlsMode,
    tlsCaPath,
    ignoredParams,
  };
}

export function ServerModal({ existing, onClose }: { existing?: ConnectionConfig | null; onClose: () => void }) {
  const { t } = useI18n();
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
  const [group, setGroup] = useState(existing?.group ?? "");
  const [schema, setSchema] = useState(existing?.schema ?? "public");
  const [host, setHost] = useState(existing?.host ?? "localhost");
  const [port, setPort] = useState(existing?.port != null ? String(existing.port) : defaultPortFor(existing?.engine ?? "sqlite"));
  const [database, setDatabase] = useState(existing?.database ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [connectionUrl, setConnectionUrl] = useState("");
  const [showConnectionUrl, setShowConnectionUrl] = useState(false);
  const [tlsMode, setTlsMode] = useState<TlsMode>(existing?.tls?.mode ?? "disable");
  const [tlsCaPath, setTlsCaPath] = useState(existing?.tls?.caPath ?? "");
  const [sshEnabled, setSshEnabled] = useState(existing?.ssh?.enabled ?? false);
  const [sshHost, setSshHost] = useState(existing?.ssh?.host ?? "");
  const [sshPort, setSshPort] = useState(String(existing?.ssh?.port ?? 22));
  const [sshUsername, setSshUsername] = useState(existing?.ssh?.username ?? "");
  const [sshAuth, setSshAuth] = useState<SshAuth>(existing?.ssh?.auth ?? "agent");
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState(existing?.ssh?.privateKeyPath ?? "");
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
      setTlsMode("disable");
      setTlsCaPath("");
      setSshEnabled(false);
    }
    if (next === "postgres" && !schema.trim()) setSchema("public");
    if (next === "mysql" && tlsMode === "allow") setTlsMode("prefer");
  };

  const applyConnectionUrl = () => {
    try {
      const parsed = parseConnectionUrl(connectionUrl);
      setEngine(parsed.engine);
      setHost(parsed.host);
      setPort(parsed.port);
      setDatabase(parsed.database);
      setUsername(parsed.username);
      setPassword(parsed.password);
      setTlsMode(parsed.tlsMode);
      setTlsCaPath(parsed.tlsCaPath);
      setDatabases(null);
      if (!name.trim()) setName(`${engineLabel(parsed.engine)} · ${parsed.database}`);
      setStatus({
        kind: "ok",
        msg: parsed.ignoredParams.length
          ? t("connection.urlIgnoredOptions", { options: parsed.ignoredParams.join(", ") })
          : parsed.tlsMode === "disable"
            ? t("connection.urlImported")
            : t("connection.urlImportedTls", { mode: parsed.tlsMode }),
      });
      setConnectionUrl("");
      setShowConnectionUrl(false);
    } catch (e) {
      setStatus({ kind: "error", msg: errMsg(e) });
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
    group: group.trim() || null,
    schema: engine === "postgres" ? schema.trim() || "public" : null,
    tls:
      engine === "sqlite" || tlsMode === "disable"
        ? null
        : {
            mode: tlsMode,
            caPath: tlsCaPath.trim() || null,
          },
    ssh:
      engine === "sqlite" || !sshEnabled
        ? null
        : {
            enabled: true,
            host: sshHost.trim(),
            port: Number(sshPort || 22) || 22,
            username: sshUsername.trim(),
            auth: sshAuth,
            privateKeyPath: sshAuth === "key" ? sshPrivateKeyPath.trim() || null : null,
          },
  });

  const testAndList = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const backend = getBackend();
      const targetDatabase = database.trim();

      // First validate the database the user actually intends to open.
      // PostgreSQL users can legitimately have access to the target DB but not
      // the maintenance "postgres" database used for server-wide discovery.
      if (targetDatabase) {
        await backend.testConnection(draftCfg(targetDatabase), password || null);
      }

      try {
        const dbs = await backend.listDatabases(draftCfg(""), password || null);
        setDatabases(dbs);
        if (dbs.length && !targetDatabase) {
          setDatabase(dbs.find((d) => !SYSTEM_DBS.has(d)) ?? dbs[0]);
        }
        setStatus({
          kind: "ok",
          msg: targetDatabase
            ? t("connection.connectedDatabases", { database: targetDatabase, count: dbs.length })
            : t("connection.serverReachable", { count: dbs.length }),
        });
      } catch (listError) {
        if (!targetDatabase) throw listError;
        setDatabases(null);
        setStatus({
          kind: "ok",
          msg: t("connection.discoveryUnavailable", { database: targetDatabase }),
        });
      }
    } catch (e) {
      setDatabases(null);
      setStatus({ kind: "error", msg: errMsg(e) });
    } finally {
      setTesting(false);
    }
  };

  const newDatabase = async () => {
    const dbName = await promptDialog({ title: t("connection.createDatabase"), label: t("connection.databaseNamePrompt"), placeholder: t("connection.databasePlaceholder") });
    const safe = dbName?.trim();
    if (!safe) return;
    setTesting(true);
    setStatus(null);
    try {
      await getBackend().createDatabase(draftCfg(""), password || null, safe);
      const dbs = await getBackend().listDatabases(draftCfg(""), password || null);
      setDatabases(dbs);
      setDatabase(safe);
      setStatus({ kind: "ok", msg: t("connection.createdDatabase", { name: safe }) });
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
      toast(t("connection.connectedTo", { name: cfg.name }), "success");
      onClose();
    } catch (e) {
      setStatus({ kind: "error", msg: errMsg(e) });
      setBusy(false);
    }
  };

  const sshValid =
    !sshEnabled ||
    (!remoteInBrowser &&
      !!sshHost.trim() &&
      !!sshUsername.trim() &&
      (sshAuth === "agent" || !!sshPrivateKeyPath.trim()));
  const tlsValid =
    tlsMode === "disable" ||
    (!remoteInBrowser && !(sshEnabled && tlsMode === "verify-full"));
  const canSave =
    !!database.trim() &&
    remoteReady &&
    sshValid &&
    tlsValid &&
    (engine === "sqlite" || !!host.trim());

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
            <span>{editing ? t("connection.settings") : t("connection.new")}</span>
            <h2>{editing ? existing?.name : t("connection.connectDatabase")}</h2>
            <p>{t("connection.localNotice")}</p>
          </div>
          <button className="odb-modal-close" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
            <IconX size={16} stroke={1.8} />
          </button>
        </header>

        <div className="odb-connection-body">
          <section className="odb-connection-section">
            <div className="odb-section-label">
              <span>01</span>
              <div>
                <b>{t("connection.engine")}</b>
                <small>{t("connection.engineDescription")}</small>
              </div>
            </div>
            <div className="odb-engine-grid">
              <button className={engine === "sqlite" ? "on" : ""} onClick={() => chooseEngine("sqlite")}>
                <IconFileDatabase size={19} stroke={1.6} />
                <span>
                  <b>SQLite</b>
                  <small>{t("connection.localFile")}</small>
                </span>
              </button>
              <button className={engine === "postgres" ? "on" : ""} onClick={() => chooseEngine("postgres")}>
                <IconDatabase size={19} stroke={1.6} />
                <span>
                  <b>PostgreSQL</b>
                  <small>{t("connection.defaultPort", { port: 5432 })}</small>
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
                <b>{t("connection.profile")}</b>
                <small>{t("connection.profileDescription")}</small>
              </div>
            </div>
            <div className="odb-form-grid profile">
              <label className="odb-form-field grow">
                <span>{t("connection.name")}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${engineLabel(engine)} connection`} />
              </label>
              <label className="odb-form-field group">
                <span>{t("connection.group")}</span>
                <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Work" />
              </label>
              <label className="odb-form-field env">
                <span>{t("connection.environment")}</span>
                <select value={env} onChange={(e) => setEnv(e.target.value as ConnEnv | "")}>
                  <option value="">{t("common.none")}</option>
                  <option value="dev">{t("connection.development")}</option>
                  <option value="staging">{t("connection.staging")}</option>
                  <option value="prod">{t("connection.production")}</option>
                </select>
              </label>
            </div>
            {env === "prod" && (
              <div className="odb-connection-alert warn">
                <IconAlertTriangle size={15} stroke={1.8} />
                <span>{t("connection.prodGuard")}</span>
              </div>
            )}
          </section>

          <section className="odb-connection-section">
            <div className="odb-section-label">
              <span>03</span>
              <div>
                <b>{engine === "sqlite" ? t("connection.database") : t("connection.server")}</b>
                <small>
                  {engine === "sqlite"
                    ? t("connection.localDatabaseDescription")
                    : t("connection.serverDescription")}
                </small>
              </div>
            </div>

            {engine !== "sqlite" && (
              <div className="odb-url-import">
                <div className="odb-url-import-head">
                  <span>
                    <IconLink size={14} stroke={1.8} />
                    {t("connection.url")}
                  </span>
                  <small>{t("connection.urlDescription")}</small>
                </div>
                <div className="odb-url-import-row">
                  <div className="odb-url-input-wrap">
                    <input
                    type={showConnectionUrl ? "text" : "password"}
                    value={connectionUrl}
                    onChange={(e) => setConnectionUrl(e.target.value)}
                    placeholder="postgresql://user:password@localhost:5432/database"
                    autoComplete="off"
                    spellCheck={false}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyConnectionUrl();
                      }
                    }}
                  />
                    <button
                      type="button"
                      className="odb-url-visibility"
                      title={showConnectionUrl ? t("connection.hideUrl") : t("connection.showUrl")}
                      aria-label={showConnectionUrl ? t("connection.hideUrl") : t("connection.showUrl")}
                      onClick={() => setShowConnectionUrl((value) => !value)}
                    >
                      {showConnectionUrl ? <IconEyeOff size={13} stroke={1.8} /> : <IconEye size={13} stroke={1.8} />}
                    </button>
                  </div>
                  <button onClick={applyConnectionUrl} disabled={!connectionUrl.trim()}>
                    {t("connection.apply")}
                  </button>
                </div>
              </div>
            )}

            {remoteInBrowser && engine !== "sqlite" && (
              <div className={`odb-connection-alert ${bridgeUp === false ? "warn" : bridgeUp ? "ok" : ""}`}>
                {bridgeUp ? <IconCheck size={15} stroke={2} /> : <IconInfoCircle size={15} stroke={1.7} />}
                <span>
                  {bridgeUp == null
                    ? t("connection.bridgeChecking")
                    : bridgeUp
                      ? t("connection.bridgeConnected")
                       : t("connection.bridgeOffline")}
                </span>
              </div>
            )}

            {engine === "sqlite" ? (
              <label className="odb-form-field">
                <span>{t("connection.databaseName")}</span>
                <input
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="analytics"
                  autoFocus={!editing}
                />
                <small>{t("connection.sqliteDescription")}</small>
              </label>
            ) : (
              <>
                <div className="odb-form-grid host">
                  <label className="odb-form-field grow">
                    <span>{t("connection.host")}</span>
                    <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
                  </label>
                  <label className="odb-form-field port">
                    <span>{t("connection.port")}</span>
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
                    <span>{t("connection.username")}</span>
                    <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
                  </label>
                  <label className="odb-form-field">
                    <span>{t("connection.password")}</span>
                    <input
                      type="password"
                      value={password}
                      placeholder={editing ? t("connection.keepPassword") : ""}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                </div>

                <div className="odb-test-row">
                  <button className="odb-test-btn" onClick={() => void testAndList()} disabled={testing || !remoteReady || !host.trim()}>
                    <IconRefresh size={14} stroke={1.8} className={testing ? "bud-spin" : ""} />
                    {testing ? t("connection.testing") : t("connection.test")}
                  </button>
                  {status && (
                    <div className={`odb-inline-status ${status.kind}`}>
                      {status.kind === "ok" ? <IconCheck size={14} stroke={2} /> : <IconAlertTriangle size={14} stroke={1.8} />}
                      <span>{status.msg}</span>
                    </div>
                  )}
                </div>

                <label className="odb-form-field">
                  <span>{t("connection.database")}</span>
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
                        placeholder={t("connection.discoverHint")}
                      />
                    )}
                    <button onClick={() => void newDatabase()} disabled={testing || !remoteReady} title="Create database">
                      <IconPlus size={14} stroke={2} />
                      New
                    </button>
                  </div>
                </label>

                {engine === "postgres" && (
                  <label className="odb-form-field">
                    <span>Default schema</span>
                    <input
                      value={schema}
                      onChange={(e) => setSchema(e.target.value)}
                      placeholder="public"
                      spellCheck={false}
                    />
                    <small>After connecting, available schemas can be switched from the SQL workspace.</small>
                  </label>
                )}
              </>
            )}
          </section>

          {engine !== "sqlite" && (
            <section className="odb-connection-section">
              <div className="odb-section-label">
                <span>04</span>
                <div>
                  <b>TLS / SSL</b>
                  <small>Transport encryption for the database connection.</small>
                </div>
              </div>

              <div className="odb-form-grid credentials">
                <label className="odb-form-field">
                  <span>TLS mode</span>
                  <select
                    value={tlsMode}
                    disabled={remoteInBrowser}
                    onChange={(e) => setTlsMode(e.target.value as TlsMode)}
                  >
                    <option value="disable">Disabled</option>
                    {engine === "postgres" && <option value="allow">Allow</option>}
                    <option value="prefer">Prefer</option>
                    <option value="require">Require</option>
                    <option value="verify-ca">Verify CA</option>
                    <option value="verify-full">{engine === "mysql" ? "Verify identity" : "Verify full"}</option>
                  </select>
                  <small>{remoteInBrowser ? "TLS profile controls are available in the desktop app." : "Disabled preserves OrbitoDB's existing non-TLS behavior."}</small>
                </label>
                <label className="odb-form-field">
                  <span>CA certificate path</span>
                  <input
                    value={tlsCaPath}
                    disabled={remoteInBrowser || tlsMode === "disable"}
                    onChange={(e) => setTlsCaPath(e.target.value)}
                    placeholder="Optional · ~/.config/orbitodb/ca.pem"
                    spellCheck={false}
                  />
                  <small>Optional. Without a custom CA, verification uses the system root store.</small>
                </label>
              </div>

              {sshEnabled && tlsMode === "verify-full" && (
                <div className="odb-connection-alert warn">
                  <IconAlertTriangle size={15} stroke={1.8} />
                  <span>
                    Verify full / identity is unavailable with OrbitoDB's local SSH forward because the driver connects to 127.0.0.1. Use Verify CA, Require, or connect directly.
                  </span>
                </div>
              )}
            </section>
          )}

          {engine !== "sqlite" && (
            <section className="odb-connection-section">
              <div className="odb-section-label">
                <span>05</span>
                <div>
                  <b>SSH tunnel</b>
                  <small>Optional local port forwarding through the system OpenSSH client.</small>
                </div>
              </div>

              <label className="odb-ssh-toggle">
                <input
                  type="checkbox"
                  checked={sshEnabled}
                  disabled={remoteInBrowser}
                  onChange={(e) => setSshEnabled(e.target.checked)}
                />
                <span>
                  <b>Connect through SSH</b>
                  <small>{remoteInBrowser ? "Available in the desktop app only." : "Uses ssh-agent or a private key without interactive prompts."}</small>
                </span>
              </label>

              {sshEnabled && (
                <div className="odb-ssh-panel">
                  <div className="odb-form-grid host">
                    <label className="odb-form-field grow">
                      <span>SSH host</span>
                      <input value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="bastion.example.com" />
                    </label>
                    <label className="odb-form-field port">
                      <span>SSH port</span>
                      <input inputMode="numeric" value={sshPort} onChange={(e) => setSshPort(e.target.value.replace(/\D/g, ""))} placeholder="22" />
                    </label>
                  </div>
                  <div className="odb-form-grid credentials">
                    <label className="odb-form-field">
                      <span>SSH username</span>
                      <input value={sshUsername} onChange={(e) => setSshUsername(e.target.value)} placeholder="ubuntu" autoComplete="off" />
                    </label>
                    <label className="odb-form-field">
                      <span>Authentication</span>
                      <select value={sshAuth} onChange={(e) => setSshAuth(e.target.value as SshAuth)}>
                        <option value="agent">ssh-agent</option>
                        <option value="key">Private key file</option>
                      </select>
                    </label>
                  </div>
                  {sshAuth === "key" && (
                    <label className="odb-form-field">
                      <span>Private key path</span>
                      <input
                        value={sshPrivateKeyPath}
                        onChange={(e) => setSshPrivateKeyPath(e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                        spellCheck={false}
                      />
                      <small>Encrypted keys should already be loaded into ssh-agent. OrbitoDB never stores an SSH passphrase.</small>
                    </label>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <footer className="odb-connection-footer">
          <span>{editing ? t("connection.keepExistingPassword") : t("connection.noAccount")}</span>
          <div>
            <MotionButton className="odb-modal-secondary" onClick={onClose}>{t("connection.cancel")}</MotionButton>
            <MotionButton className="odb-modal-primary" onClick={() => void save()} disabled={busy || !canSave}>
              {busy ? t("connection.connecting") : editing ? t("connection.saveReconnect") : t("connection.connect")}
            </MotionButton>
          </div>
        </footer>
      </motion.div>
    </>
  );
}
