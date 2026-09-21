import { describe, expect, it } from "vitest";
import { quoteIdentifier, selectTableSql } from "./sql";

describe("SQL identifier helpers", () => {
  it("quotes reserved words, spaces, and embedded quote characters", () => {
    expect(quoteIdentifier('order "items"', "sqlite")).toBe('"order ""items"""');
    expect(quoteIdentifier("order `items`", "mysql")).toBe("`order ``items```");
  });

  it("builds a safe table-browser query", () => {
    expect(selectTableSql("select", "postgres", 200)).toBe('SELECT * FROM "select" LIMIT 200;');
  });
});
