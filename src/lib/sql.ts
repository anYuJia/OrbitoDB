import type { Engine } from "../ipc/types";

/** Quote a database identifier without changing its spelling. */
export function quoteIdentifier(name: string, engine?: Engine): string {
  if (engine === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** Build the table-browser query for names that may contain spaces or keywords. */
export function selectTableSql(name: string, engine?: Engine, limit = 1000): string {
  return `SELECT * FROM ${quoteIdentifier(name, engine)} LIMIT ${limit};`;
}
