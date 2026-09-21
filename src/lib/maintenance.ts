import type { Engine } from "../ipc/types";
import { quoteDdlIdentifier } from "./ddl";

export type MaintenanceAction = "analyze" | "optimize" | "vacuum";

export interface MaintenancePlan {
  sql: string;
  label: string;
  scope: "table" | "database";
  requiresTable: boolean;
  destructive: boolean;
}

export function buildMaintenancePlan(
  engine: Engine,
  action: MaintenanceAction,
  table?: string | null,
): MaintenancePlan {
  const q = (value: string) => quoteDdlIdentifier(engine, value);
  const tableName = table?.trim() ?? "";

  if (action === "analyze") {
    if (!tableName) throw new Error("Choose a table before running Analyze.");
    if (engine === "mysql") {
      return {
        sql: `ANALYZE TABLE ${q(tableName)};`,
        label: "Analyze table",
        scope: "table",
        requiresTable: true,
        destructive: false,
      };
    }
    return {
      sql: `ANALYZE ${q(tableName)};`,
      label: "Analyze table",
      scope: "table",
      requiresTable: true,
      destructive: false,
    };
  }

  if (action === "optimize") {
    if (engine === "sqlite") {
      return {
        sql: "PRAGMA optimize;",
        label: "Optimize database",
        scope: "database",
        requiresTable: false,
        destructive: false,
      };
    }
    if (!tableName) throw new Error("Choose a table before running Optimize.");
    if (engine === "mysql") {
      return {
        sql: `OPTIMIZE TABLE ${q(tableName)};`,
        label: "Optimize table",
        scope: "table",
        requiresTable: true,
        destructive: false,
      };
    }
    return {
      sql: `VACUUM (ANALYZE) ${q(tableName)};`,
      label: "Vacuum + analyze table",
      scope: "table",
      requiresTable: true,
      destructive: false,
    };
  }

  if (engine !== "sqlite") {
    throw new Error("Full database Vacuum is only exposed for SQLite.");
  }
  return {
    sql: "VACUUM;",
    label: "Vacuum database",
    scope: "database",
    requiresTable: false,
    destructive: false,
  };
}
