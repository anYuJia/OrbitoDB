import { confirmDialog } from "./dialog";

const WRITE_RE = /\b(insert|update|delete|drop|alter|truncate|create|replace|merge|grant|revoke)\b/i;
const DESTRUCTIVE_RE = /\b(drop|truncate)\b/i;

/**
 * Keep SQL structure while masking comments, strings, and quoted identifiers.
 * Safety checks must inspect every statement in a script without treating words
 * such as "delete" inside a value or comment as executable SQL.
 */
function executableSql(sql: string): string {
  let out = "";
  let i = 0;
  const mask = (text: string) => text.replace(/[^\n;]/g, " ");

  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      const stop = end < 0 ? sql.length : end;
      out += mask(sql.slice(i, stop));
      i = stop;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      out += mask(sql.slice(i, stop));
      i = stop;
      continue;
    }

    const quote = sql[i];
    if (quote === "'" || quote === '"' || quote === "`") {
      let end = i + 1;
      while (end < sql.length) {
        if (sql[end] === quote) {
          if (sql[end + 1] === quote) {
            end += 2;
            continue;
          }
          end += 1;
          break;
        }
        if (sql[end] === "\\" && quote !== '"') end += 1;
        end += 1;
      }
      out += mask(sql.slice(i, end));
      i = end;
      continue;
    }

    if (quote === "$") {
      const delimiter = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        const closing = sql.indexOf(delimiter, i + delimiter.length);
        const end = closing < 0 ? sql.length : closing + delimiter.length;
        out += mask(sql.slice(i, end));
        i = end;
        continue;
      }
    }

    out += sql[i];
    i += 1;
  }
  return out;
}

/** Does the statement modify data/schema (vs a read-only SELECT/EXPLAIN)? */
export function isWrite(sql: string): boolean {
  return WRITE_RE.test(executableSql(sql));
}

/** Does the script change objects that appear in the schema browser? */
export function changesSchema(sql: string): boolean {
  return /\b(create|alter|drop|rename)\s+(?:or\s+replace\s+)?(table|view|index|schema|database|trigger|sequence|function|procedure)\b/i.test(
    executableSql(sql),
  );
}

/**
 * If the statement is destructive (DROP/TRUNCATE, or DELETE/UPDATE with no
 * WHERE), ask for confirmation. Returns true when it's safe to proceed.
 */
export async function confirmIfDestructive(sql: string): Promise<boolean> {
  const code = executableSql(sql);
  if (DESTRUCTIVE_RE.test(code)) {
    return confirmDialog({
      title: "Run destructive statement?",
      message: "This DROP/TRUNCATE permanently removes a table or all its rows. This can't be undone.",
      confirmLabel: "Run anyway",
      danger: true,
    });
  }
  const hasUnboundedMutation = code
    .split(";")
    .some((statement) => /\b(delete|update)\b/i.test(statement) && !/\bwhere\b/i.test(statement));
  if (hasUnboundedMutation) {
    return confirmDialog({
      title: "Run without a WHERE clause?",
      message: "This UPDATE/DELETE has no WHERE — it affects every row in the table. This can't be undone.",
      confirmLabel: "Run anyway",
      danger: true,
    });
  }
  return true;
}

/**
 * Extra guard for connections tagged `prod`: any write gets an explicit
 * "you're on production" confirm. Returns true when it's safe to proceed.
 */
export async function confirmProdWrite(
  conn: { name: string; env?: string | null } | undefined,
  sql: string,
): Promise<boolean> {
  if (!conn || conn.env !== "prod" || !isWrite(sql)) return true;
  return confirmDialog({
    title: "Write to PRODUCTION?",
    message: `“${conn.name}” is flagged as a production connection. This statement modifies data and can't be undone. Run it on production?`,
    confirmLabel: "Run on production",
    danger: true,
  });
}
