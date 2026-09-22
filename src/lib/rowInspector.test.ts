import { describe, expect, it } from "vitest";
import { matchesRecordField, sameCellValue } from "./rowInspector";

describe("sameCellValue", () => {
  it("keeps database NULL distinct from an empty string", () => {
    expect(sameCellValue(null, "")).toBe(false);
    expect(sameCellValue(undefined, "")).toBe(false);
  });

  it("treats nullish values as the same database value", () => {
    expect(sameCellValue(null, undefined)).toBe(true);
  });

  it("avoids false changes when drivers and inputs use different scalar types", () => {
    expect(sameCellValue(42, "42")).toBe(true);
    expect(sameCellValue(true, "true")).toBe(true);
  });
});

describe("matchesRecordField", () => {
  const column = { name: "created_at", dataType: "TIMESTAMP" };

  it("matches both field names and data types", () => {
    expect(matchesRecordField(column, "created")).toBe(true);
    expect(matchesRecordField(column, "timestamp")).toBe(true);
    expect(matchesRecordField(column, "integer")).toBe(false);
  });
});
