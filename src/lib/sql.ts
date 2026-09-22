import type { Engine, QueryResult } from "../ipc/types";

export const TABLE_BROWSER_ROW_LIMIT = 1000;

/** Quote a database identifier without changing its spelling. */
export function quoteIdentifier(name: string, engine?: Engine): string {
  if (engine === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** Build the table-browser query for names that may contain spaces or keywords. */
export function selectTableSql(name: string, engine?: Engine, limit = 1000): string {
  return `SELECT * FROM ${quoteIdentifier(name, engine)} LIMIT ${limit};`;
}

/**
 * Keep one look-ahead row long enough to tell the grid that more data exists,
 * then return only the rows the browser promises to render.
 */
export function capQueryResult(result: QueryResult, limit: number): QueryResult {
  if (result.rows.length <= limit) return result;
  return { ...result, rows: result.rows.slice(0, limit), truncated: true };
}
