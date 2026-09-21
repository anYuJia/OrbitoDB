import type { Engine } from "../ipc/types";

export type ExplainMode = "plan" | "analyze";

function oneStatement(sql: string): string {
  const body = sql.trim().replace(/;\s*$/, "").trim();
  if (!body) throw new Error("Select a query to explain.");
  if (body.includes(";")) {
    throw new Error("Explain works on one SQL statement at a time.");
  }
  return body;
}

function scrubLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

export function isReadOnlyQuery(sql: string): boolean {
  const body = scrubLiteralsAndComments(oneStatement(sql)).trimStart();
  if (!/^(SELECT|WITH)\b/i.test(body)) return false;
  return !/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|GRANT|REVOKE|CALL|DO|COPY)\b/i.test(body);
}

export function buildExplainSql(
  engine: Engine,
  sql: string,
  mode: ExplainMode,
  serverVersion?: string | null,
): string {
  const body = oneStatement(sql);

  if (mode === "analyze" && !isReadOnlyQuery(body)) {
    throw new Error("Analyze is limited to SELECT / WITH queries because it executes the statement.");
  }

  if (engine === "sqlite") {
    if (mode === "analyze") {
      throw new Error("SQLite does not expose an EXPLAIN ANALYZE equivalent. Use Explain plan.");
    }
    return `EXPLAIN QUERY PLAN ${body};`;
  }

  if (engine === "postgres") {
    return mode === "analyze"
      ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${body};`
      : `EXPLAIN (VERBOSE, COSTS, FORMAT JSON) ${body};`;
  }

  if (mode === "analyze") {
    return /mariadb/i.test(serverVersion ?? "")
      ? `ANALYZE FORMAT=JSON ${body};`
      : `EXPLAIN ANALYZE ${body};`;
  }
  return `EXPLAIN FORMAT=JSON ${body};`;
}
