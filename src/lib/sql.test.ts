import { describe, expect, it } from "vitest";
import { capQueryResult, quoteIdentifier, selectTableSql } from "./sql";

describe("SQL identifier helpers", () => {
  it("quotes reserved words, spaces, and embedded quote characters", () => {
    expect(quoteIdentifier('order "items"', "sqlite")).toBe('"order ""items"""');
    expect(quoteIdentifier("order `items`", "mysql")).toBe("`order ``items```");
  });

  it("builds a safe table-browser query", () => {
    expect(selectTableSql("select", "postgres", 200)).toBe('SELECT * FROM "select" LIMIT 200;');
  });

  it("uses a look-ahead row to mark capped table results", () => {
    const result = capQueryResult(
      {
        columns: [{ name: "id", dataType: "INTEGER" }],
        rows: [[1], [2], [3]],
        rowsAffected: 0,
        elapsedMs: 1,
        truncated: false,
      },
      2,
    );

    expect(result.rows).toEqual([[1], [2]]);
    expect(result.truncated).toBe(true);
  });

  it("preserves results that fit within the table limit", () => {
    const result = {
      columns: [{ name: "id", dataType: "INTEGER" }],
      rows: [[1], [2]],
      rowsAffected: 0,
      elapsedMs: 1,
      truncated: false,
    };

    expect(capQueryResult(result, 2)).toBe(result);
  });
});
