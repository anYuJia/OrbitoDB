import { describe, expect, it } from "vitest";
import { fromCsv, inferColumns, toCsv } from "./csv";

describe("delimited file parsing", () => {
  it("keeps quoted commas, escaped quotes, and line breaks in one cell", () => {
    const parsed = fromCsv('id,note\r\n1,"hello, ""team"""\r\n2,"line one\r\nline two"\r\n');

    expect(parsed.headers).toEqual(["id", "note"]);
    expect(parsed.rows).toEqual([
      ["1", 'hello, "team"'],
      ["2", "line one\nline two"],
    ]);
    expect(parsed.malformedRows).toEqual([]);
    expect(parsed.unterminatedQuote).toBe(false);
  });

  it("detects tab-separated files and removes a UTF-8 BOM", () => {
    const parsed = fromCsv("\uFEFFid\tname\n1\tAda\n");

    expect(parsed.delimiter).toBe("\t");
    expect(parsed.headers).toEqual(["id", "name"]);
    expect(parsed.rows).toEqual([["1", "Ada"]]);
  });

  it("normalizes blank and duplicate headers without losing columns", () => {
    const parsed = fromCsv("name, name ,,name\nAda,Lovelace,x,Countess");

    expect(parsed.headers).toEqual(["name", "name_2", "col3", "name_3"]);
    expect(parsed.normalizedHeaders).toBe(3);
  });

  it("reports shifted rows and unterminated quoted fields", () => {
    const shifted = fromCsv("id,name\n1,Ada\n2\n3,Grace,extra");
    const unterminated = fromCsv('id,note\n1,"unfinished');

    expect(shifted.malformedRows).toEqual([3, 4]);
    expect(unterminated.unterminatedQuote).toBe(true);
  });
});

describe("CSV helpers", () => {
  it("infers useful SQL scalar types", () => {
    expect(inferColumns(["id", "score", "name"], [["1", "2.5", "Ada"]])).toEqual([
      { name: "id", dataType: "INTEGER", nullable: true, primaryKey: false },
      { name: "score", dataType: "REAL", nullable: true, primaryKey: false },
      { name: "name", dataType: "TEXT", nullable: true, primaryKey: false },
    ]);
  });

  it("quotes exported values that contain separators", () => {
    expect(toCsv({
      columns: [{ name: "note", dataType: "TEXT" }],
      rows: [['hello, "team"']],
      rowsAffected: 0,
      elapsedMs: 1,
      truncated: false,
    })).toBe('note\n"hello, ""team"""');
  });
});
