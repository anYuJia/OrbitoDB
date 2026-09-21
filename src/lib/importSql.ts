import type { Engine } from "../ipc/types";
import { quoteDdlIdentifier } from "./ddl";

function literal(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

export function buildBulkInsertStatements(
  engine: Engine,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 200,
): string[] {
  if (!columns.length) throw new Error("Import needs at least one mapped column.");
  if (rows.some((row) => row.length !== columns.length)) {
    throw new Error("Import row width does not match the mapped columns.");
  }

  const q = (value: string) => quoteDdlIdentifier(engine, value);
  const size = Math.max(1, Math.min(500, Math.floor(chunkSize) || 200));
  const prefix = `INSERT INTO ${q(table)} (${columns.map(q).join(", ")}) VALUES `;
  const statements: string[] = [];

  for (let start = 0; start < rows.length; start += size) {
    const values = rows
      .slice(start, start + size)
      .map((row) => `(${row.map(literal).join(", ")})`)
      .join(", ");
    statements.push(prefix + values + ";");
  }
  return statements;
}
