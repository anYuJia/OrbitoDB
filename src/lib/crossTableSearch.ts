import type { ColumnInfo, Engine } from "../ipc/types";

export const CROSS_TABLE_MAX_TABLES = 40;
export const CROSS_TABLE_MAX_COLUMNS = 20;
export const CROSS_TABLE_MAX_RESULTS = 100;
export const CROSS_TABLE_ROWS_PER_TABLE = 8;

export function quoteSearchIdentifier(engine: Engine, value: string): string {
  return engine === "mysql"
    ? "`" + value.replace(/`/g, "``") + "`"
    : '"' + value.replace(/"/g, '""') + '"';
}

function sqlLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

export function isCrossTableSearchable(column: ColumnInfo): boolean {
  const type = column.dataType.toLowerCase();
  return !["blob", "binary", "varbinary", "bytea", "image", "geometry", "geography"].some((token) =>
    type.includes(token),
  );
}

export function buildCrossTableSearchSql(
  engine: Engine,
  table: string,
  columns: ColumnInfo[],
  term: string,
): string {
  const q = (value: string) => quoteSearchIdentifier(engine, value);
  const selected = columns.slice(0, CROSS_TABLE_MAX_COLUMNS);
  if (!selected.length) throw new Error("Cross-table search requires at least one searchable column.");

  const needle = sqlLiteral(term.toLowerCase());
  const castType = engine === "mysql" ? "CHAR" : "TEXT";
  const contains = (column: ColumnInfo) => {
    const value = `LOWER(CAST(${q(column.name)} AS ${castType}))`;
    if (engine === "mysql") return `LOCATE(${needle}, ${value}) > 0`;
    if (engine === "postgres") return `POSITION(${needle} IN ${value}) > 0`;
    return `INSTR(${value}, ${needle}) > 0`;
  };

  return [
    `SELECT ${selected.map((column) => q(column.name)).join(", ")}`,
    `FROM ${q(table)}`,
    `WHERE ${selected.map(contains).join(" OR ")}`,
    `LIMIT ${CROSS_TABLE_ROWS_PER_TABLE}`,
  ].join(" ");
}
