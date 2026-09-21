import { describe, expect, it } from "vitest";
import { isWrite } from "./safety";

describe("write safety classification", () => {
  it("treats database maintenance statements as write-like", () => {
    expect(isWrite("VACUUM;")).toBe(true);
    expect(isWrite("ANALYZE users;")).toBe(true);
    expect(isWrite("OPTIMIZE TABLE users;")).toBe(true);
    expect(isWrite("PRAGMA optimize;")).toBe(true);
  });

  it("keeps read-only explain/select statements non-writing", () => {
    expect(isWrite("SELECT * FROM users")).toBe(false);
    expect(isWrite("EXPLAIN SELECT * FROM users")).toBe(false);
    expect(isWrite("EXPLAIN QUERY PLAN SELECT * FROM users")).toBe(false);
  });
});
