import { describe, expect, it } from "vitest";
import { detectDelimited, fromCsv, fromTsv } from "./csv";

describe("delimited import parsing", () => {
  it("parses quoted commas, escaped quotes and multiline cells", () => {
    const parsed = fromCsv('name,note\nAda,"hello, world"\nBob,"line 1\nline 2"\nEve,"say ""hi"""');
    expect(parsed.headers).toEqual(["name", "note"]);
    expect(parsed.rows).toEqual([
      ["Ada", "hello, world"],
      ["Bob", "line 1\nline 2"],
      ["Eve", 'say "hi"'],
    ]);
  });

  it("parses TSV and strips a UTF-8 BOM", () => {
    const parsed = fromTsv("\uFEFFid\tname\n1\tAda");
    expect(parsed.headers).toEqual(["id", "name"]);
    expect(parsed.rows).toEqual([["1", "Ada"]]);
  });

  it("detects TSV from the file name", () => {
    const parsed = detectDelimited("id\tname\n1\tAda", "users.tsv");
    expect(parsed.delimiter).toBe("\t");
    expect(parsed.headers).toEqual(["id", "name"]);
  });

  it("ignores a trailing blank line without dropping empty cells", () => {
    const parsed = fromCsv("a,b\n1,\n");
    expect(parsed.rows).toEqual([["1", ""]]);
  });
});
