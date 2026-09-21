import type { ConnectionConfig } from "../ipc/types";

function dq(value: string): string {
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function filename(value: string, ext: string): string {
  const base = value.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || "database";
  return `${base}${ext}`;
}

export interface NativeBackupCommands {
  backup: string;
  restore: string;
  note: string;
}

export function buildNativeBackupCommands(connection: ConnectionConfig): NativeBackupCommands {
  if (connection.engine === "sqlite") {
    throw new Error("SQLite uses OrbitoDB managed snapshots instead of an external dump command.");
  }

  const host = connection.host?.trim() || "localhost";
  const user = connection.username?.trim() || (connection.engine === "postgres" ? "postgres" : "root");
  const port = connection.port ?? (connection.engine === "postgres" ? 5432 : 3306);
  const database = connection.database.trim();

  if (connection.engine === "postgres") {
    const file = filename(database, ".dump");
    return {
      backup: [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        `--file=${dq(file)}`,
        `--host=${dq(host)}`,
        `--port=${port}`,
        `--username=${dq(user)}`,
        dq(database),
      ].join(" "),
      restore: [
        "pg_restore",
        "--clean",
        "--if-exists",
        "--no-owner",
        `--host=${dq(host)}`,
        `--port=${port}`,
        `--username=${dq(user)}`,
        `--dbname=${dq(database)}`,
        dq(file),
      ].join(" "),
      note: connection.ssh?.enabled
        ? "Run where the database host is reachable, or establish the SSH tunnel separately first. Passwords are intentionally omitted."
        : "Passwords are intentionally omitted; pg_dump/pg_restore will use your normal PostgreSQL credential sources or prompt.",
    };
  }

  const file = filename(database, ".sql");
  const common = [`--host=${dq(host)}`, `--port=${port}`, `--user=${dq(user)}`];
  return {
    backup: [
      "mysqldump",
      "--single-transaction",
      "--routines",
      "--triggers",
      "--events",
      ...common,
      dq(database),
      ">",
      dq(file),
    ].join(" "),
    restore: ["mysql", ...common, dq(database), "<", dq(file)].join(" "),
    note: connection.ssh?.enabled
      ? "Run where the database host is reachable, or establish the SSH tunnel separately first. Passwords are intentionally omitted."
      : "Passwords are intentionally omitted; mysql/mysqldump will use your normal credential sources or prompt.",
  };
}
