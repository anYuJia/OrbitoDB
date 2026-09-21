import { describe, expect, it } from "vitest";
import { buildExplainSql, isReadOnlyQuery } from "./explain";

describe("explain", () => {
  it("builds PostgreSQL plan and analyze statements", () => {
    expect(buildExplainSql("postgres", "SELECT * FROM users;", "plan")).toBe(
      "EXPLAIN (VERBOSE, COSTS, FORMAT JSON) SELECT * FROM users;",
    );
    expect(buildExplainSql("postgres", "WITH x AS (SELECT 1) SELECT * FROM x", "analyze")).toBe(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) WITH x AS (SELECT 1) SELECT * FROM x;",
    );
  });

  it("distinguishes MySQL from MariaDB analyze syntax", () => {
    expect(buildExplainSql("mysql", "SELECT * FROM users", "plan")).toBe(
      "EXPLAIN FORMAT=JSON SELECT * FROM users;",
    );
    expect(buildExplainSql("mysql", "SELECT * FROM users", "analyze", "MySQL 8.4.0")).toBe(
      "EXPLAIN ANALYZE SELECT * FROM users;",
    );
    expect(buildExplainSql("mysql", "SELECT * FROM users", "analyze", "11.4.2-MariaDB")).toBe(
      "ANALYZE FORMAT=JSON SELECT * FROM users;",
    );
  });

  it("keeps SQLite honest about analyze support", () => {
    expect(buildExplainSql("sqlite", "SELECT * FROM users", "plan")).toBe(
      "EXPLAIN QUERY PLAN SELECT * FROM users;",
    );
    expect(() => buildExplainSql("sqlite", "SELECT * FROM users", "analyze")).toThrow(/does not expose/i);
  });

  it("never analyzes writes because analyze executes the statement", () => {
    expect(isReadOnlyQuery("SELECT 1")).toBe(true);
    expect(isReadOnlyQuery("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
    expect(() => buildExplainSql("postgres", "UPDATE users SET active = false", "analyze")).toThrow(
      /SELECT \/ WITH/i,
    );
  });

  it("rejects multiple statements", () => {
    expect(() => buildExplainSql("postgres", "SELECT 1; SELECT 2", "plan")).toThrow(/one SQL statement/i);
  });
});
