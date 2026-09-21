import { describe, expect, it } from "vitest";
import { buildTablePageSql } from "./tablePaging";

describe("tablePaging", () => {
  it("builds server-side LIMIT/OFFSET pages", () => {
    const sql = buildTablePageSql("postgres", "users", ["id", "email"], 2, 100);
    expect(sql.countSql).toBe('SELECT COUNT(*) AS __orbitodb_count FROM "users";');
    expect(sql.dataSql).toBe('SELECT * FROM "users" LIMIT 100 OFFSET 200;');
  });

  it("quotes MySQL identifiers and searches all supplied columns", () => {
    const sql = buildTablePageSql("mysql", "order", ["id", "customer"], 0, 50, "O'Brien");
    expect(sql.countSql).toContain("FROM `order` WHERE");
    expect(sql.countSql).toContain("CAST(`customer` AS CHAR) LIKE '%O''Brien%'");
    expect(sql.dataSql).toContain("LIMIT 50 OFFSET 0");
  });

  it("caps page size and normalizes negative pages", () => {
    const sql = buildTablePageSql("sqlite", "events", ["body"], -3, 5000);
    expect(sql.dataSql).toContain("LIMIT 1000 OFFSET 0");
  });
});
