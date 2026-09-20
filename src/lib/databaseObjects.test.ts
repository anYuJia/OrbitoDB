import { describe, expect, it } from "vitest";
import {
  buildCreateViewSql,
  buildDatabaseObjectTemplate,
  buildDropDatabaseObjectSql,
} from "./databaseObjects";

describe("databaseObjects", () => {
  it("builds one-statement CREATE VIEW safely", () => {
    expect(buildCreateViewSql("postgres", "active users", "SELECT * FROM users WHERE active = true;")).toBe(
      'CREATE VIEW "active users" AS SELECT * FROM users WHERE active = true;',
    );
    expect(() => buildCreateViewSql("postgres", "v", "DELETE FROM users")).toThrow(/SELECT or WITH/i);
    expect(() => buildCreateViewSql("postgres", "v", "SELECT 1; DROP TABLE users")).toThrow(/one statement/i);
  });

  it("drops overloaded PostgreSQL routines with identity arguments", () => {
    expect(
      buildDropDatabaseObjectSql("postgres", {
        name: "lookup",
        kind: "function",
        signature: "integer, text",
        definition: null,
      }),
    ).toBe('DROP FUNCTION "lookup"(integer, text);');
    expect(
      buildDropDatabaseObjectSql("postgres", {
        name: "audit_insert",
        kind: "trigger",
        table: "events",
      }),
    ).toBe('DROP TRIGGER "audit_insert" ON "events";');
  });

  it("uses table-qualified MySQL index drops", () => {
    expect(
      buildDropDatabaseObjectSql("mysql", {
        name: "idx_users_email",
        kind: "index",
        table: "users",
      }),
    ).toBe("DROP INDEX `idx_users_email` ON `users`;");
  });

  it("generates executable object templates per engine", () => {
    expect(buildDatabaseObjectTemplate("postgres", "sequence")).toContain('CREATE SEQUENCE "sequence_name"');
    expect(buildDatabaseObjectTemplate("mysql", "function")).toContain("CREATE FUNCTION `function_name`()");
    expect(buildDatabaseObjectTemplate("sqlite", "trigger", "users")).toContain(
      'BEFORE INSERT ON "users"',
    );
    expect(() => buildDatabaseObjectTemplate("sqlite", "procedure")).toThrow(/does not support/i);
  });
});
