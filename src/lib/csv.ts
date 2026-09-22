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

export interface DelimitedParseResult {
  headers: string[];
  rows: string[][];
  delimiter: "," | "\t" | ";";
  malformedRows: number[];
  normalizedHeaders: number;
  skippedEmptyRows: number;
  unterminatedQuote: boolean;
}

function detectDelimiter(text: string): DelimitedParseResult["delimiter"] {
  const counts = new Map<DelimitedParseResult["delimiter"], number>([[",", 0], ["\t", 0], [";", 0]]);
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) break;
    if (!quoted && counts.has(character as DelimitedParseResult["delimiter"])) {
      const delimiter = character as DelimitedParseResult["delimiter"];
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? ",";
}

function normalizeHeaders(rawHeaders: string[]): { headers: string[]; changed: number } {
  const used = new Set<string>();
  let changed = 0;
  const headers = rawHeaders.map((raw, index) => {
    const trimmed = raw.trim();
    const base = trimmed || `col${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase());
    if (candidate !== raw) changed += 1;
    return candidate;
  });
  return { headers, changed };
}

/**
 * Parse comma, tab, or semicolon-delimited text. The state-machine keeps
 * quoted line breaks intact, strips a UTF-8 BOM, and reports structural
 * problems instead of silently importing shifted columns.
 */
export function fromCsv(
  text: string,
  forcedDelimiter?: DelimitedParseResult["delimiter"],
): DelimitedParseResult {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = forcedDelimiter ?? detectDelimiter(source);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  const finishField = () => {
    record.push(field);
    field = "";
  };
  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else if (character === "\r") {
        field += "\n";
        if (source[index + 1] === "\n") index += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      finishField();
    } else if (character === "\n" || character === "\r") {
      finishRecord();
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (field.length > 0 || record.length > 0) finishRecord();
  let skippedEmptyRows = 0;
  const nonEmptyRecords = records.filter((item, index) => {
    if (index === 0 || item.some((value) => value.length > 0)) return true;
    skippedEmptyRows += 1;
    return false;
  });
  if (nonEmptyRecords.length === 0) {
    return {
      headers: [],
      rows: [],
      delimiter,
      malformedRows: [],
      normalizedHeaders: 0,
      skippedEmptyRows,
      unterminatedQuote: quoted,
    };
  }

  const normalized = normalizeHeaders(nonEmptyRecords[0]);
  const rows = nonEmptyRecords.slice(1);
  const malformedRows = rows.flatMap((row, index) => (
    row.length === normalized.headers.length ? [] : [index + 2]
  ));
  return {
    headers: normalized.headers,
    rows,
    delimiter,
    malformedRows,
    normalizedHeaders: normalized.changed,
    skippedEmptyRows,
    unterminatedQuote: quoted,
  };
}
