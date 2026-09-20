// TypeScript mirrors of the Rust DTOs (camelCase, matching serde output).

export type Engine = "postgres" | "mysql" | "sqlite";

/** Environment tag for a connection — drives the colour dot and the prod guard. */
export type ConnEnv = "dev" | "staging" | "prod";
export type SshAuth = "agent" | "key";
export type TlsMode = "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full";

export interface TlsConfig {
  mode: TlsMode;
  caPath?: string | null;
}

export interface SshTunnelConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  privateKeyPath?: string | null;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  engine: Engine;
  host?: string | null;
  port?: number | null;
  database: string;
  username?: string | null;
  env?: ConnEnv | null;
  group?: string | null;
  schema?: string | null;
  tls?: TlsConfig | null;
  ssh?: SshTunnelConfig | null;
}

export interface ConnectionDiagnostics {
  serverVersion: string;
  database: string;
  schema: string | null;
  latencyMs: number;
}

export interface Column {
  name: string;
  dataType: string;
}

export interface QueryResult {
  columns: Column[];
  rows: unknown[][];
  rowsAffected: number;
  elapsedMs: number;
  truncated: boolean;
}

export interface TableInfo {
  name: string;
  kind: string; // "table" | "view"
  schema: string | null;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string | null;
  generated?: string | null;
  comment?: string | null;
  extra?: string | null;
}

/** A foreign-key relationship: table.column references refTable.refColumn. */
export interface ForeignKey {
  name?: string | null;
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  detail: string;
}

export type ConstraintKind = "primary" | "unique" | "check";

export interface ConstraintInfo {
  name?: string | null;
  kind: ConstraintKind;
  definition: string;
  columns: string[];
}

export interface ColumnDef {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface HistoryEntry {
  id: number;
  connectionId: string;
  sql: string;
  ranAt: string;
}

/** Mirror of the Rust `AppError` flattened serialization. */
export interface AppError {
  kind: string;
  message?: string;
  position?: number | null;
}
