import type { ColumnDef, QueryResult } from "../ipc/types";

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(r: QueryResult): string {
  const header = r.columns.map((c) => csvCell(c.name)).join(",");
  const body = r.rows.map((row) => row.map(csvCell).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function toJson(r: QueryResult): string {
  const objs = r.rows.map((row) =>
    Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]])),
  );
  return JSON.stringify(objs, null, 2);
}

/** Tab-separated — what spreadsheets expect when pasting from the clipboard. */
export function toTsv(r: QueryResult): string {
  const clean = (v: unknown) => (v == null ? "" : String(v).replace(/[\t\n\r]+/g, " "));
  const header = r.columns.map((c) => clean(c.name)).join("\t");
  const body = r.rows.map((row) => row.map(clean).join("\t")).join("\n");
  return `${header}\n${body}`;
}

/** GitHub-flavored Markdown table. */
export function toMarkdown(r: QueryResult): string {
  const cell = (v: unknown) => (v == null ? "" : String(v).replace(/\|/g, "\\|").replace(/\n/g, " "));
  const names = r.columns.map((c) => cell(c.name));
  const head = `| ${names.join(" | ")} |`;
  const sep = `| ${names.map(() => "---").join(" | ")} |`;
  const body = r.rows.map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

function sqlLiteral(v: unknown): string {
  if (v == null) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** A runnable batch of INSERT statements for the result rows. */
export function toInserts(r: QueryResult, table = "table_name"): string {
  const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const cols = r.columns.map((c) => ident(c.name)).join(", ");
  return r.rows
    .map((row) => `INSERT INTO ${ident(table)} (${cols}) VALUES (${row.map(sqlLiteral).join(", ")});`)
    .join("\n");
}

export function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Guess a column's SQL type from its values: INTEGER, REAL, or TEXT. */
function inferType(rows: string[][], col: number): string {
  let int = true;
  let num = true;
  let seen = false;
  for (const r of rows) {
    const v = (r[col] ?? "").trim();
    if (v === "") continue;
    seen = true;
    if (!/^-?\d+$/.test(v)) int = false;
    if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)) num = false;
    if (!int && !num) return "TEXT";
  }
  return !seen ? "TEXT" : int ? "INTEGER" : num ? "REAL" : "TEXT";
}

/** Build nullable column defs (with inferred types) for a parsed CSV. */
export function inferColumns(headers: string[], rows: string[][]): ColumnDef[] {
  return headers.map((h, i) => ({
    name: h.trim() || `col${i + 1}`,
    dataType: inferType(rows, i),
    nullable: true,
    primaryKey: false,
  }));
}

/** Parse delimited text with RFC-style quoted fields, escaped quotes and embedded newlines. */
export function fromDelimited(text: string, delimiter: "," | "\t"): { headers: string[]; rows: string[][] } {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parsed: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.length > 0)) parsed.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else {
      cell += ch;
    }
  }

  if (cell.length || row.length) pushRow();
  if (!parsed.length) return { headers: [], rows: [] };
  return { headers: parsed[0], rows: parsed.slice(1) };
}

export function fromCsv(text: string): { headers: string[]; rows: string[][] } {
  return fromDelimited(text, ",");
}

export function fromTsv(text: string): { headers: string[]; rows: string[][] } {
  return fromDelimited(text, "\t");
}

export function detectDelimited(text: string, filename = ""): { delimiter: "," | "\t"; headers: string[]; rows: string[][] } {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) {
    const parsed = fromTsv(text);
    return { delimiter: "\t", ...parsed };
  }
  if (lower.endsWith(".csv")) {
    const parsed = fromCsv(text);
    return { delimiter: ",", ...parsed };
  }

  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const delimiter: "," | "\t" = tabs > commas ? "\t" : ",";
  const parsed = fromDelimited(text, delimiter);
  return { delimiter, ...parsed };
}
