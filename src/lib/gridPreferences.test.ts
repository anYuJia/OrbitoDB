import { describe, expect, it } from "vitest";
import {
  GRID_DENSITY_KEY,
  gridColumnsStorageKey,
  normalizeHiddenColumns,
  readGridDensity,
  readHiddenColumns,
  uniqueColumnLabels,
  writeGridDensity,
  writeHiddenColumns,
} from "./gridPreferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("grid preferences", () => {
  it("creates stable unique labels for duplicate query columns", () => {
    expect(uniqueColumnLabels(["id", "name", "id", "id", "id (2)"])).toEqual([
      "id",
      "name",
      "id (2)",
      "id (3)",
      "id (2) (2)",
    ]);
  });

  it("removes stale and duplicate hidden columns", () => {
    expect(normalizeHiddenColumns(["email", "gone", "email"], ["id", "email", "status"])).toEqual(["email"]);
  });

  it("never allows every column to be hidden", () => {
    expect(normalizeHiddenColumns(["id", "email"], ["id", "email"])).toEqual(["email"]);
  });

  it("scopes column visibility to a connection and table", () => {
    const storage = memoryStorage();
    writeHiddenColumns(storage, "local dev", "order/items", ["notes"]);

    expect(readHiddenColumns(storage, "local dev", "order/items", ["id", "notes"])).toEqual(["notes"]);
    expect(readHiddenColumns(storage, "production", "order/items", ["id", "notes"])).toEqual([]);
    expect(gridColumnsStorageKey("local dev", "order/items")).toContain("local%20dev:order%2Fitems");
  });

  it("persists compact density and safely defaults invalid values", () => {
    const storage = memoryStorage();
    writeGridDensity(storage, "compact");
    expect(readGridDensity(storage)).toBe("compact");
    storage.setItem(GRID_DENSITY_KEY, "tiny");
    expect(readGridDensity(storage)).toBe("comfortable");
  });
});
