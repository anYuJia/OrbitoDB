/**
 * Database NULL is intentionally different from an empty string. Other scalar
 * values are compared as their displayed form so native drivers returning `1`
 * and inputs returning `"1"` do not create a false dirty state.
 */
export function sameCellValue(left: unknown, right: unknown): boolean {
  const leftNull = left == null;
  const rightNull = right == null;
  if (leftNull || rightNull) return leftNull && rightNull;
  return String(left) === String(right);
}

export function matchesRecordField(
  column: { name: string; dataType: string },
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${column.name} ${column.dataType}`.toLocaleLowerCase().includes(needle);
}
