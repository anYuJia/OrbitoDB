import type { DatabaseObjectInfo, DatabaseObjectKind, Engine } from "../ipc/types";
import { quoteDdlIdentifier } from "./ddl";

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, "").trim();
}

export function buildCreateViewSql(engine: Engine, name: string, query: string): string {
  const objectName = name.trim();
  const body = stripTrailingSemicolon(query);
  if (!objectName) throw new Error("View name cannot be empty.");
  if (!/^(SELECT|WITH)\b/i.test(body)) {
    throw new Error("A view must be created from a SELECT or WITH query.");
  }
  if (body.includes(";")) {
    throw new Error("View query must contain exactly one statement.");
  }
  return `CREATE VIEW ${quoteDdlIdentifier(engine, objectName)} AS ${body};`;
}

export function buildDropDatabaseObjectSql(
  engine: Engine,
  object: DatabaseObjectInfo,
): string {
  const q = (value: string) => quoteDdlIdentifier(engine, value);
  switch (object.kind) {
    case "view":
      return `DROP VIEW ${q(object.name)};`;
    case "index":
      if (engine === "mysql") {
        if (!object.table) throw new Error("MySQL index metadata is missing its table.");
        return `DROP INDEX ${q(object.name)} ON ${q(object.table)};`;
      }
      return `DROP INDEX ${q(object.name)};`;
    case "sequence":
      if (engine !== "postgres") throw new Error("Sequences are only supported here for PostgreSQL.");
      return `DROP SEQUENCE ${q(object.name)};`;
    case "trigger":
      if (engine === "postgres") {
        if (!object.table) throw new Error("PostgreSQL trigger metadata is missing its table.");
        return `DROP TRIGGER ${q(object.name)} ON ${q(object.table)};`;
      }
      return `DROP TRIGGER ${q(object.name)};`;
    case "procedure":
    case "function": {
      const keyword = object.kind.toUpperCase();
      if (engine === "postgres") {
        const signature = object.signature?.trim() ?? "";
        return `DROP ${keyword} ${q(object.name)}(${signature});`;
      }
      return `DROP ${keyword} ${q(object.name)};`;
    }
  }
}

export function buildDatabaseObjectTemplate(
  engine: Engine,
  kind: Exclude<DatabaseObjectKind, "view" | "index">,
  table?: string | null,
): string {
  const q = (value: string) => quoteDdlIdentifier(engine, value);
  if (kind === "sequence") {
    if (engine !== "postgres") throw new Error("Sequence templates are only available for PostgreSQL.");
    return [
      "-- Review and run when ready.",
      `CREATE SEQUENCE ${q("sequence_name")}`,
      "  START WITH 1",
      "  INCREMENT BY 1",
      "  NO CYCLE;",
    ].join("\n");
  }

  if (kind === "function") {
    if (engine === "postgres") {
      return [
        "-- Review return type, arguments and language before running.",
        `CREATE FUNCTION ${q("function_name")}()`,
        "RETURNS integer",
        "LANGUAGE sql",
        "AS $$",
        "  SELECT 1;",
        "$$;",
      ].join("\n");
    }
    if (engine === "mysql") {
      return [
        "-- DELIMITER is a CLI concern; OrbitoDB sends this CREATE statement directly.",
        `CREATE FUNCTION ${q("function_name")}()`,
        "RETURNS INTEGER",
        "DETERMINISTIC",
        "RETURN 1;",
      ].join("\n");
    }
    throw new Error("SQLite does not support stored SQL functions.");
  }

  if (kind === "procedure") {
    if (engine === "postgres") {
      return [
        "-- Review arguments and language before running.",
        `CREATE PROCEDURE ${q("procedure_name")}()`,
        "LANGUAGE plpgsql",
        "AS $$",
        "BEGIN",
        "  -- procedure body",
        "END;",
        "$$;",
      ].join("\n");
    }
    if (engine === "mysql") {
      return [
        "-- OrbitoDB sends the complete CREATE PROCEDURE statement directly.",
        `CREATE PROCEDURE ${q("procedure_name")}()`,
        "BEGIN",
        "  SELECT 1;",
        "END;",
      ].join("\n");
    }
    throw new Error("SQLite does not support stored procedures.");
  }

  if (kind === "trigger") {
    const tableName = table?.trim();
    if (!tableName) throw new Error("Choose a table before creating a trigger template.");
    if (engine === "postgres") {
      return [
        "-- PostgreSQL triggers call a trigger function.",
        `CREATE FUNCTION ${q("trigger_function")}()`,
        "RETURNS trigger",
        "LANGUAGE plpgsql",
        "AS $$",
        "BEGIN",
        "  RETURN NEW;",
        "END;",
        "$$;",
        "",
        `CREATE TRIGGER ${q("trigger_name")}`,
        `BEFORE INSERT ON ${q(tableName)}`,
        "FOR EACH ROW",
        `EXECUTE FUNCTION ${q("trigger_function")}();`,
      ].join("\n");
    }
    if (engine === "mysql") {
      return [
        `CREATE TRIGGER ${q("trigger_name")}`,
        `BEFORE INSERT ON ${q(tableName)}`,
        "FOR EACH ROW",
        "SET @orbitodb_trigger = 1;",
      ].join("\n");
    }
    return [
      `CREATE TRIGGER ${q("trigger_name")}`,
      `BEFORE INSERT ON ${q(tableName)}`,
      "FOR EACH ROW",
      "BEGIN",
      "  SELECT 1;",
      "END;",
    ].join("\n");
  }

  throw new Error(`Unsupported object template: ${kind}`);
}
