import { describe, expect, it } from "vitest";
import { buildBulkInsertStatements } from "./importSql";

describe("importSql", () => {
  it("builds safe multi-row inserts and escapes strings", () => {
    const [sql] = buildBulkInsertStatements(
      "postgres",
      "users",
      ["name", "age"],
      [["O'Brien", "33"], ["Ada", null]],
    );
    expect(sql).toBe(
      'INSERT INTO "users" ("name", "age") VALUES (\'O\'\'Brien\', \'33\'), (\'Ada\', NULL);',
    );
  });

  it("chunks large imports", () => {
    const rows = Array.from({ length: 5 }, (_, i) => [String(i)]);
    const statements = buildBulkInsertStatements("sqlite", "t", ["id"], rows, 2);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("('0'), ('1')");
    expect(statements[2]).toContain("('4')");
  });

  it("uses MySQL identifier quoting", () => {
    const [sql] = buildBulkInsertStatements("mysql", "order", ["select"], [["x"]]);
    expect(sql).toContain("INSERT INTO `order` (`select`)");
  });

  it("rejects mismatched mapped rows", () => {
    expect(() => buildBulkInsertStatements("postgres", "t", ["a", "b"], [["x"]])).toThrow(/width/i);
  });
});
