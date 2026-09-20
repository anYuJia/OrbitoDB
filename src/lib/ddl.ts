import type { ColumnInfo, Engine, ForeignKey, IndexInfo } from "../ipc/types";

export function quoteDdlIdentifier(engine: Engine, value: string): string {
  return engine === "mysql"
    ? "`" + value.replace(/`/g, "``") + "`"
    : '"' + value.replace(/"/g, '""') + '"';
}

function groupForeignKeys(foreignKeys: ForeignKey[]): ForeignKey[][] {
  const named = new Map<string, ForeignKey[]>();
  const groups: ForeignKey[][] = [];
  for (const fk of foreignKeys) {
    if (!fk.name) {
      groups.push([fk]);
      continue;
    }
    const current = named.get(fk.name) ?? [];
    current.push(fk);
    named.set(fk.name, current);
  }
  groups.push(...named.values());
  return groups;
}

function indexColumns(detail: string): string[] {
  if (!detail || /CREATE\s+(UNIQUE\s+)?INDEX/i.test(detail)) return [];
  const base = detail.split("·")[0].replace(/^origin:\s*\w+$/i, "").trim();
  if (!base) return [];
  return base
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value));
}

function isManagedIndex(engine: Engine, name: string): boolean {
  return name === "PRIMARY" || name.startsWith("sqlite_autoindex_") || (engine === "postgres" && name.endsWith("_pkey"));
}

export function buildTableDdl(
  engine: Engine,
  table: string,
  columns: ColumnInfo[],
  foreignKeys: ForeignKey[] = [],
  indexes: IndexInfo[] = [],
): string {
  const q = (value: string) => quoteDdlIdentifier(engine, value);
  if (!columns.length) return `-- No column information available for ${table}`;

  const primaryKeys = columns.filter((column) => column.isPrimaryKey);
  const defs = columns.map((column) => {
    let line = `  ${q(column.name)} ${column.dataType || "TEXT"}`;
    if (primaryKeys.length === 1 && column.isPrimaryKey) line += " PRIMARY KEY";
    else if (!column.nullable) line += " NOT NULL";
    return line;
  });

  if (primaryKeys.length > 1) {
    defs.push(`  PRIMARY KEY (${primaryKeys.map((column) => q(column.name)).join(", ")})`);
  }

  const tableFks = foreignKeys.filter((fk) => fk.table === table);
  for (const group of groupForeignKeys(tableFks)) {
    const first = group[0];
    const local = group.map((fk) => q(fk.column)).join(", ");
    const remote = group.map((fk) => q(fk.refColumn)).join(", ");
    const constraint = first.name ? `CONSTRAINT ${q(first.name)} ` : "";
    defs.push(
      `  ${constraint}FOREIGN KEY (${local}) REFERENCES ${q(first.refTable)} (${remote})`,
    );
  }

  const statements = [
    `-- Generated from OrbitoDB schema metadata for ${engine}.`,
    "-- Defaults, CHECK constraints, generated expressions, triggers and engine-specific options may require review.",
    `CREATE TABLE ${q(table)} (`,
    defs.join(",\n"),
    ");",
  ];

  const secondary = indexes.filter((index) => !isManagedIndex(engine, index.name));
  if (secondary.length) statements.push("", "-- Secondary indexes");
  for (const index of secondary) {
    const definition = index.detail.trim();
    if (engine === "postgres" && /^CREATE\s+(UNIQUE\s+)?INDEX/i.test(definition)) {
      statements.push(definition.replace(/;?\s*$/, ";"));
      continue;
    }

    const cols = indexColumns(definition);
    if (cols.length) {
      statements.push(
        `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${q(index.name)} ON ${q(table)} (${cols
          .map(q)
          .join(", ")});`,
      );
    } else {
      statements.push(
        `-- Index ${q(index.name)}${index.unique ? " (UNIQUE)" : ""} exists, but its exact column/expression definition was not available from metadata.`,
      );
    }
  }

  return statements.join("\n");
}
