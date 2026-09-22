import type { Engine, QueryResult } from "../ipc/types";

export const TABLE_BROWSER_ROW_LIMIT = 1000;
export type TableFilterOp = "=" | "!=" | "contains" | ">" | "<";

export interface TableFilter {
  column: string;
  op: TableFilterOp;
  value: string;
}

/** Quote a database identifier without changing its spelling. */
export function quoteIdentifier(name: string, engine?: Engine): string {
  if (engine === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** Build the table-browser query for names that may contain spaces or keywords. */
export function selectTableSql(name: string, engine?: Engine, limit = 1000): string {
  return `SELECT * FROM ${quoteIdentifier(name, engine)} LIMIT ${limit};`;
}

/** Quote a user-authored SQL string literal for the selected engine. */
export function quoteSqlString(value: string, engine?: Engine): string {
  // MySQL treats backslashes as escapes unless NO_BACKSLASH_ESCAPES is enabled.
  // Doubling them is safe in either mode and prevents a backslash from escaping
  // one of the quote characters doubled below.
  const escaped = engine === "mysql" ? value.replace(/\\/g, "\\\\") : value;
  return `'${escaped.replace(/'/g, "''")}'`;
}

/** Build one engine-aware, escaped condition for a saved table view. */
export function tableFilterConditionSql(filter: TableFilter, engine?: Engine): string {
  const column = quoteIdentifier(filter.column, engine);
  const value = quoteSqlString(filter.value, engine);
  if (filter.op === "contains") {
    const textType = engine === "mysql" ? "CHAR" : "TEXT";
    const escapedLike = filter.value
      .toLowerCase()
      .replace(/!/g, "!!")
      .replace(/%/g, "!%")
      .replace(/_/g, "!_");
    return `LOWER(CAST(${column} AS ${textType})) LIKE ${quoteSqlString(`%${escapedLike}%`, engine)} ESCAPE '!'`;
  }
  const op = filter.op === "!=" ? "<>" : filter.op;
  return `${column} ${op} ${value}`;
}

/** Build a table-browser query whose filter runs in the database. */
export function selectFilteredTableSql(
  name: string,
  filter: TableFilter | null,
  engine?: Engine,
  limit = TABLE_BROWSER_ROW_LIMIT,
): string {
  const where = filter ? ` WHERE ${tableFilterConditionSql(filter, engine)}` : "";
  return `SELECT * FROM ${quoteIdentifier(name, engine)}${where} LIMIT ${limit};`;
}

/**
 * Keep one look-ahead row long enough to tell the grid that more data exists,
 * then return only the rows the browser promises to render.
 */
export function capQueryResult(result: QueryResult, limit: number): QueryResult {
  if (result.rows.length <= limit) return result;
  return { ...result, rows: result.rows.slice(0, limit), truncated: true };
}
