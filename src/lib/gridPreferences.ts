export type GridDensity = "comfortable" | "compact";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const GRID_COLUMNS_PREFIX = "orbitodb.gridColumns.v1";
export const GRID_DENSITY_KEY = "orbitodb.gridDensity.v1";

/**
 * SQL joins can return the same column name more than once. Give every column
 * a stable display key so visibility controls never hide two columns at once
 * or render duplicate React keys.
 */
export function uniqueColumnLabels(columns: string[]): string[] {
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();

  return columns.map((column) => {
    if (!used.has(column)) {
      used.add(column);
      nextSuffix.set(column, 2);
      return column;
    }

    let suffix = nextSuffix.get(column) ?? 2;
    let label = `${column} (${suffix})`;
    while (used.has(label)) {
      suffix += 1;
      label = `${column} (${suffix})`;
    }
    nextSuffix.set(column, suffix + 1);
    used.add(label);
    return label;
  });
}

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
