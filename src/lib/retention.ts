export const MAX_EDITOR_TABS = 24;
export const MAX_SAVED_ITEMS = 200;
export const MAX_QUERY_HISTORY = 1000;

export function capNewest<T>(items: T[], max: number): T[] {
  if (max <= 0) return [];
  return items.length <= max ? items : items.slice(0, max);
}

export function canOpenEditor(currentCount: number): boolean {
  return currentCount < MAX_EDITOR_TABS;
}
