import type { Engine } from "../ipc/types";

export const DEFAULT_PORTS: Record<Exclude<Engine, "sqlite">, number> = {
  postgres: 5432,
  mysql: 3306,
};

export interface ParsedPort {
  error: string | null;
  value: number | null;
}

/** Parse an optional port while preserving engine defaults and useful errors. */
export function parseConnectionPort(engine: Engine, raw: string): ParsedPort {
  if (engine === "sqlite") return { error: null, value: null };
  const value = raw.trim();
  if (!value) return { error: null, value: DEFAULT_PORTS[engine] };
  if (!/^\d+$/.test(value)) return { error: "Use a whole number between 1 and 65535.", value: null };
  const port = Number(value);
  if (port < 1 || port > 65535) return { error: "Port must be between 1 and 65535.", value: null };
  return { error: null, value: port };
}

/**
 * Browser SQLite names become filenames on the local bridge. Keep them exact so
 * the UI never claims one name while the backend silently opens another file.
 */
export function managedSqliteNameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a database name.";
  if (name.length > 64) return "Use 64 characters or fewer.";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    return "Use letters, numbers, underscores, or hyphens; start with a letter or number.";
  }
  return null;
}

/** Safe cross-engine identifier for the create-database action. */
export function serverDatabaseNameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a database name.";
  if (name.length > 63) return "Use 63 characters or fewer.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Start with a letter or underscore, then use only letters, numbers, and underscores.";
  }
  return null;
}

export function connectionEndpoint(
  engine: Engine,
  host: string,
  port: number | null,
  database: string,
): string {
  if (engine === "sqlite") return database.trim() || "Choose a database";
  const enginePort = port ?? DEFAULT_PORTS[engine];
  const location = `${host.trim() || "localhost"}:${enginePort}`;
  return database.trim() ? `${location} / ${database.trim()}` : location;
}
