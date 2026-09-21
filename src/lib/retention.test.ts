import { describe, expect, it } from "vitest";
import { MAX_EDITOR_TABS, MAX_QUERY_HISTORY, MAX_SAVED_ITEMS, canOpenEditor, capNewest } from "./retention";

describe("retention", () => {
  it("keeps newest items and caps old ones", () => {
    expect(capNewest([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(capNewest([1, 2], 5)).toEqual([1, 2]);
    expect(capNewest([1, 2], 0)).toEqual([]);
  });

  it("enforces editor capacity without evicting open work", () => {
    expect(canOpenEditor(MAX_EDITOR_TABS - 1)).toBe(true);
    expect(canOpenEditor(MAX_EDITOR_TABS)).toBe(false);
  });

  it("documents stable workspace limits", () => {
    expect(MAX_EDITOR_TABS).toBe(24);
    expect(MAX_SAVED_ITEMS).toBe(200);
    expect(MAX_QUERY_HISTORY).toBe(1000);
  });
});
