export type GridDensity = "comfortable" | "compact";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const GRID_COLUMNS_PREFIX = "orbitodb.gridColumns.v1";
export const GRID_DENSITY_KEY = "orbitodb.gridDensity.v1";

export function gridColumnsStorageKey(connectionId: string, table: string): string {
  return `${GRID_COLUMNS_PREFIX}:${encodeURIComponent(connectionId)}:${encodeURIComponent(table)}`;
}

/**
 * Drop stale/duplicate column names and always leave at least one column visible.
 * Keeping the first column is the safest fallback because it is commonly the row id.
 */
export function normalizeHiddenColumns(value: unknown, columns: string[]): string[] {
  if (!Array.isArray(value) || columns.length === 0) return [];
  const known = new Set(columns);
  const hidden = [...new Set(value.filter((name): name is string => typeof name === "string" && known.has(name)))];
  return hidden.length < columns.length ? hidden : hidden.filter((name) => name !== columns[0]);
}

export function readHiddenColumns(
  storage: StorageLike | null,
  connectionId: string,
  table: string,
  columns: string[],
): string[] {
  if (!storage) return [];
  try {
    const saved = storage.getItem(gridColumnsStorageKey(connectionId, table));
    return normalizeHiddenColumns(saved ? JSON.parse(saved) : [], columns);
  } catch {
    return [];
  }
}

export function writeHiddenColumns(
  storage: StorageLike | null,
  connectionId: string,
  table: string,
  hidden: string[],
): void {
  if (!storage) return;
  try {
    storage.setItem(gridColumnsStorageKey(connectionId, table), JSON.stringify(hidden));
  } catch {
    /* Browsing still works when storage is unavailable. */
  }
}

export function readGridDensity(storage: StorageLike | null): GridDensity {
  try {
    return storage?.getItem(GRID_DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function writeGridDensity(storage: StorageLike | null, density: GridDensity): void {
  if (!storage) return;
  try {
    storage.setItem(GRID_DENSITY_KEY, density);
  } catch {
    /* Browsing still works when storage is unavailable. */
  }
}
