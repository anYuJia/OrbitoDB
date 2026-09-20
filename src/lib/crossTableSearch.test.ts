import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "../ipc/types";
import {
  buildCrossTableSearchSql,
  isCrossTableSearchable,
  quoteSearchIdentifier,
} from "./crossTableSearch";

const columns: ColumnInfo[] = [
  { name: "display_name", dataType: "TEXT", nullable: true, isPrimaryKey: false },
  { name: "email", dataType: "VARCHAR", nullable: false, isPrimaryKey: false },
];

describe("cross-table search SQL", () => {
  it("uses PostgreSQL POSITION with quoted identifiers", () => {
    const sql = buildCrossTableSearchSql("postgres", "user accounts", columns, "O'Reilly");
    expect(sql).toContain('FROM "user accounts"');
    expect(sql).toContain("POSITION('o''reilly' IN LOWER(CAST(\"display_name\" AS TEXT))) > 0");
    expect(sql).toContain("LIMIT 8");
  });

  it("uses MySQL LOCATE and backticks", () => {
    const sql = buildCrossTableSearchSql("mysql", "users", columns, "Alice");
    expect(sql).toContain("FROM `users`");
    expect(sql).toContain("LOCATE('alice', LOWER(CAST(`display_name` AS CHAR))) > 0");
  });

  it("uses SQLite INSTR", () => {
    const sql = buildCrossTableSearchSql("sqlite", "users", columns, "Bob");
    expect(sql).toContain("INSTR(LOWER(CAST(\"email\" AS TEXT)), 'bob') > 0");
  });

  it("escapes identifiers and skips binary-like columns", () => {
    expect(quoteSearchIdentifier("postgres", 'a"b')).toBe('"a""b"');
    expect(quoteSearchIdentifier("mysql", "a`b")).toBe("`a``b`");
    expect(
      isCrossTableSearchable({ name: "payload", dataType: "BYTEA", nullable: true, isPrimaryKey: false }),
    ).toBe(false);
  });
});
