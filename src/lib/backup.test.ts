import { describe, expect, it } from "vitest";
import { buildNativeBackupCommands } from "./backup";

describe("backup command builder", () => {
  it("builds PostgreSQL pg_dump / pg_restore without embedding a password", () => {
    const commands = buildNativeBackupCommands({
      id: "pg",
      name: "Postgres",
      engine: "postgres",
      host: "db.example.com",
      port: 5433,
      database: "app_db",
      username: "deploy",
    });
    expect(commands.backup).toContain("pg_dump");
    expect(commands.backup).toContain('--host="db.example.com"');
    expect(commands.backup).toContain('--port=5433');
    expect(commands.backup).toContain('--username="deploy"');
    expect(commands.backup).toContain('"app_db"');
    expect(commands.restore).toContain("pg_restore");
    expect(commands.restore).toContain('--dbname="app_db"');
    expect(commands.backup.toLowerCase()).not.toContain("password");
  });

  it("builds MySQL logical dump / restore commands with routines and triggers", () => {
    const commands = buildNativeBackupCommands({
      id: "my",
      name: "MySQL",
      engine: "mysql",
      host: "localhost",
      database: "shop",
      username: "root",
    });
    expect(commands.backup).toContain("mysqldump");
    expect(commands.backup).toContain("--single-transaction");
    expect(commands.backup).toContain("--routines");
    expect(commands.backup).toContain("--triggers");
    expect(commands.backup).toContain('"shop.sql"');
    expect(commands.restore).toContain("mysql");
    expect(commands.restore).toContain('< "shop.sql"');
  });

  it("keeps SSH-backed command guidance explicit", () => {
    const commands = buildNativeBackupCommands({
      id: "pg-ssh",
      name: "Postgres through SSH",
      engine: "postgres",
      host: "10.0.0.3",
      database: "app",
      username: "postgres",
      ssh: {
        enabled: true,
        host: "bastion.example.com",
        port: 22,
        username: "deploy",
        auth: "agent",
      },
    });
    expect(commands.note).toMatch(/SSH tunnel/i);
  });

  it("does not pretend SQLite needs external dump tools", () => {
    expect(() =>
      buildNativeBackupCommands({
        id: "lite",
        name: "Local",
        engine: "sqlite",
        database: "local.sqlite",
      }),
    ).toThrow(/managed snapshots/i);
  });
});
