import type { Engine } from "../ipc/types";
import { quoteDdlIdentifier } from "./ddl";

export interface TablePageSql {
  countSql: string;
  dataSql: string;
}

function sqlString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

export function buildTablePageSql(
  engine: Engine,
  table: string,
  columns: string[],
  page: number,
  pageSize: number,
  search = "",
): TablePageSql {
  const safePage = Math.max(0, Math.floor(page));
  const safeSize = Math.min(1000, Math.max(10, Math.floor(pageSize)));
  const q = (value: string) => quoteDdlIdentifier(engine, value);
  const tableRef = q(table);
  const needle = search.trim();

  let where = "";
  if (needle && columns.length) {
    const pattern = sqlString(`%${needle}%`);
    const expressions = columns.map((column) => {
      const ident = q(column);
      const text = engine === "mysql" ? `CAST(${ident} AS CHAR)` : `CAST(${ident} AS TEXT)`;
      return `${text} LIKE ${pattern}`;
    });
    where = ` WHERE ${expressions.join(" OR ")}`;
  }

  return {
    countSql: `SELECT COUNT(*) AS __orbitodb_count FROM ${tableRef}${where};`,
    dataSql: `SELECT * FROM ${tableRef}${where} LIMIT ${safeSize} OFFSET ${safePage * safeSize};`,
  };
}
