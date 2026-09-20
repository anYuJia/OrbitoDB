import type { ColumnInfo, ConstraintInfo, Engine, ForeignKey, IndexInfo } from "../ipc/types";
import { buildTableDdl, quoteDdlIdentifier, renderColumnDefault } from "./ddl";

export interface ColumnEditDraft {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  comment: string | null;
}

export interface ColumnAlterPlan {
  statements: string[];
  requiresReview: boolean;
  reason?: string;
}

function sqlString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

export function isSafeSqlFragment(value: string): boolean {
  const trimmed = value.trim();
  return !!trimmed && !/[;]/.test(trimmed) && !/--|\/\*/.test(trimmed);
}

function normalized(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mysqlExtra(extra: string | null | undefined, generated: boolean): string {
  if (!extra) return "";
  const parts: string[] = [];
  if (/\bauto_increment\b/i.test(extra)) parts.push("AUTO_INCREMENT");
  const onUpdate = extra.match(/\bon update\s+(.+)$/i);
  if (onUpdate?.[1]) parts.push(`ON UPDATE ${onUpdate[1].trim()}`);
  if (generated) {
    if (/\bstored generated\b/i.test(extra)) parts.push("STORED");
    else parts.push("VIRTUAL");
  }
  return parts.join(" ");
}

export function buildColumnAlterPlan(
  engine: Engine,
  table: string,
  current: ColumnInfo,
  next: ColumnEditDraft,
): ColumnAlterPlan {
  const q = (value: string) => quoteDdlIdentifier(engine, value);
  const nextName = next.name.trim();
  const nextType = next.dataType.trim();
  if (!nextName) throw new Error("Column name cannot be empty.");
  if (!isSafeSqlFragment(nextType)) throw new Error("Column type contains unsafe SQL tokens.");

  const currentDefault = normalized(current.defaultValue);
  const nextDefault = normalized(next.defaultValue);
  if (nextDefault && !isSafeSqlFragment(nextDefault)) {
    throw new Error("Default expression contains unsafe SQL tokens.");
  }

  if (engine === "sqlite") {
    const onlyRename =
      nextName !== current.name &&
      nextType.toLowerCase() === (current.dataType || "TEXT").trim().toLowerCase() &&
      next.nullable === current.nullable &&
      nextDefault === currentDefault &&
      normalized(next.comment) === normalized(current.comment);
    if (onlyRename) {
      return {
        statements: [`ALTER TABLE ${q(table)} RENAME COLUMN ${q(current.name)} TO ${q(nextName)};`],
        requiresReview: false,
      };
    }
    return {
      statements: [],
      requiresReview: true,
      reason: "SQLite requires a table rebuild for type, nullability, default, comment, or generated-column changes.",
    };
  }

  if (engine === "postgres") {
    const statements: string[] = [];
    let name = current.name;
    if (nextName !== current.name) {
      statements.push(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(current.name)} TO ${q(nextName)};`);
      name = nextName;
    }

    if (nextType.toLowerCase() !== (current.dataType || "TEXT").trim().toLowerCase()) {
      statements.push(`ALTER TABLE ${q(table)} ALTER COLUMN ${q(name)} TYPE ${nextType};`);
    }
    if (next.nullable !== current.nullable) {
      statements.push(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(name)} ${next.nullable ? "DROP" : "SET"} NOT NULL;`,
      );
    }
    if (nextDefault !== currentDefault) {
      if (current.generated || /IDENTITY/i.test(current.extra ?? "")) {
        throw new Error("Generated/identity columns cannot change DEFAULT through the property editor.");
      }
      statements.push(
        nextDefault
          ? `ALTER TABLE ${q(table)} ALTER COLUMN ${q(name)} SET DEFAULT ${nextDefault};`
          : `ALTER TABLE ${q(table)} ALTER COLUMN ${q(name)} DROP DEFAULT;`,
      );
    }
    if (normalized(next.comment) !== normalized(current.comment)) {
      statements.push(
        `COMMENT ON COLUMN ${q(table)}.${q(name)} IS ${normalized(next.comment) ? sqlString(next.comment!.trim()) : "NULL"};`,
      );
    }
    return { statements, requiresReview: false };
  }

  const generated = normalized(current.generated);
  if (generated && nextDefault !== currentDefault) {
    throw new Error("Generated columns cannot define a DEFAULT value.");
  }

  const synthetic: ColumnInfo = {
    ...current,
    name: nextName,
    dataType: nextType,
    nullable: next.nullable,
    defaultValue: nextDefault,
    comment: normalized(next.comment),
  };
  let definition = `${q(nextName)} ${nextType}`;
  if (generated) {
    definition += ` GENERATED ALWAYS AS (${generated})`;
    const extra = mysqlExtra(current.extra, true);
    if (extra) definition += ` ${extra}`;
  } else {
    const rendered = renderColumnDefault("mysql", synthetic);
    if (rendered != null) definition += ` DEFAULT ${rendered}`;
    definition += next.nullable ? " NULL" : " NOT NULL";
    const extra = mysqlExtra(current.extra, false);
    if (extra) definition += ` ${extra}`;
  }
  if (normalized(next.comment)) definition += ` COMMENT ${sqlString(next.comment!.trim())}`;

  return {
    statements: [`ALTER TABLE ${q(table)} CHANGE COLUMN ${q(current.name)} ${definition};`],
    requiresReview: false,
  };
}

export function buildConstraintAddSql(
  engine: Engine,
  table: string,
  kind: ConstraintInfo["kind"],
  name: string | null,
  columns: string[],
  checkExpression?: string,
): string {
  if (engine === "sqlite") throw new Error("SQLite constraint changes require a table rebuild.");
  const q = (value: string) => quoteDdlIdentifier(engine, value);
  const constraintName = normalized(name);
  if (kind === "check") {
    const expression = normalized(checkExpression);
    if (!expression || !isSafeSqlFragment(expression)) throw new Error("Enter a safe CHECK expression.");
    if (!constraintName) throw new Error("CHECK constraints require a name.");
    return `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(constraintName)} CHECK (${expression});`;
  }
  if (!columns.length) throw new Error("Select at least one constraint column.");
  const cols = columns.map(q).join(", ");
  if (kind === "primary") {
    return engine === "mysql"
      ? `ALTER TABLE ${q(table)} ADD PRIMARY KEY (${cols});`
      : `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(constraintName || `${table}_pkey`)} PRIMARY KEY (${cols});`;
  }
  if (!constraintName) throw new Error("UNIQUE constraints require a name.");
  return `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(constraintName)} UNIQUE (${cols});`;
}

export function buildConstraintDropSql(
  engine: Engine,
  table: string,
  constraint: ConstraintInfo,
): string {
  if (engine === "sqlite") throw new Error("SQLite constraint changes require a table rebuild.");
  const q = (value: string) => quoteDdlIdentifier(engine, value);
  if (engine === "postgres") {
    if (!constraint.name) throw new Error("Constraint name is unavailable.");
    return `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(constraint.name)};`;
  }
  if (constraint.kind === "primary") return `ALTER TABLE ${q(table)} DROP PRIMARY KEY;`;
  if (!constraint.name) throw new Error("Constraint name is unavailable.");
  if (constraint.kind === "unique") return `ALTER TABLE ${q(table)} DROP INDEX ${q(constraint.name)};`;
  return `ALTER TABLE ${q(table)} DROP CHECK ${q(constraint.name)};`;
}

export function buildSqliteRebuildSql(
  table: string,
  currentColumns: ColumnInfo[],
  editedColumn: string,
  next: ColumnEditDraft,
  foreignKeys: ForeignKey[],
  indexes: IndexInfo[],
  constraints: ConstraintInfo[],
): string {
  if (currentColumns.some((column) => column.generated)) {
    throw new Error("SQLite generated-column expressions are not recoverable safely; review the original CREATE TABLE manually.");
  }

  const nextColumns = currentColumns.map((column) =>
    column.name === editedColumn
      ? {
          ...column,
          name: next.name.trim(),
          dataType: next.dataType.trim(),
          nullable: next.nullable,
          defaultValue: normalized(next.defaultValue),
          comment: normalized(next.comment),
        }
      : column,
  );
  const temp = `__orbitodb_rebuild_${table.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const q = (value: string) => quoteDdlIdentifier("sqlite", value);
  const renamed = next.name.trim() !== editedColumn;
  if (renamed && constraints.some((constraint) => constraint.kind === "check")) {
    throw new Error(
      "SQLite column rename with CHECK constraints needs manual DDL review because CHECK expressions cannot be rewritten safely.",
    );
  }

  const mappedFks = foreignKeys
    .filter((fk) => fk.table === table)
    .map((fk) => ({
      ...fk,
      table: temp,
      column: fk.column === editedColumn ? next.name.trim() : fk.column,
      refColumn: fk.refTable === table && fk.refColumn === editedColumn ? next.name.trim() : fk.refColumn,
    }));

  const mappedConstraints = constraints.map((constraint) => {
    const mappedColumns = constraint.columns.map((column) =>
      column === editedColumn ? next.name.trim() : column,
    );
    return {
      ...constraint,
      columns: mappedColumns,
      definition:
        constraint.kind === "unique"
          ? `UNIQUE (${mappedColumns.map(q).join(", ")})`
          : constraint.definition,
    };
  });

  const escaped = editedColumn.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\  const temp = `__orbitodb_rebuild_${table.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const mappedFks = foreignKeys
    .filter((fk) => fk.table === table)
    .map((fk) => ({
      ...fk,
      table: temp,
      column: fk.column === editedColumn ? next.name.trim() : fk.column,
      refColumn: fk.refTable === table && fk.refColumn === editedColumn ? next.name.trim() : fk.refColumn,
    }));
  const mappedConstraints = constraints.map((constraint) => ({
    ...constraint,
    columns: constraint.columns.map((column) => (column === editedColumn ? next.name.trim() : column)),
    definition: constraint.definition,
  }));

  const create = buildTableDdl("sqlite", temp, nextColumns, mappedFks, indexes, mappedConstraints);
  const q = (value: string) => quoteDdlIdentifier("sqlite", value);");
  const columnToken = new RegExp(`\\b${escaped}\\b`, "g");
  const mappedIndexes = indexes.map((index) => ({
    ...index,
    detail: renamed ? index.detail.replace(columnToken, next.name.trim()) : index.detail,
  }));

  const create = buildTableDdl("sqlite", temp, nextColumns, mappedFks, mappedIndexes, mappedConstraints);
  const sourceColumns = currentColumns.map((column) => q(column.name)).join(", ");
  const targetColumns = nextColumns.map((column) => q(column.name)).join(", ");

  return [
    "-- Review-first SQLite rebuild generated by OrbitoDB.",
    "-- Verify triggers/views that depend on this table before running.",
    "PRAGMA foreign_keys=OFF;",
    "BEGIN;",
    create,
    `INSERT INTO ${q(temp)} (${targetColumns}) SELECT ${sourceColumns} FROM ${q(table)};`,
    `DROP TABLE ${q(table)};`,
    `ALTER TABLE ${q(temp)} RENAME TO ${q(table)};`,
    "COMMIT;",
    "PRAGMA foreign_keys=ON;",
  ].join("\n");
}
