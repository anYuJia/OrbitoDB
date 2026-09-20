import { describe, expect, it } from "vitest";
import { buildTableDdl } from "./ddl";

describe("buildTableDdl", () => {
  it("renders composite primary keys and foreign keys safely", () => {
    const ddl = buildTableDdl(
      "postgres",
      "order items",
      [
        { name: "order_id", dataType: "bigint", nullable: false, isPrimaryKey: true },
        { name: "line_no", dataType: "integer", nullable: false, isPrimaryKey: true },
        { name: "product_id", dataType: "bigint", nullable: false, isPrimaryKey: false },
      ],
      [
        {
          name: "fk_order_items_product",
          table: "order items",
          column: "product_id",
          refTable: "products",
          refColumn: "id",
        },
      ],
      [],
    );

    expect(ddl).toContain('PRIMARY KEY ("order_id", "line_no")');
    expect(ddl).toContain(
      'CONSTRAINT "fk_order_items_product" FOREIGN KEY ("product_id") REFERENCES "products" ("id")',
    );
  });

  it("reuses PostgreSQL index definitions", () => {
    const ddl = buildTableDdl(
      "postgres",
      "users",
      [{ name: "email", dataType: "text", nullable: false, isPrimaryKey: false }],
      [],
      [
        {
          name: "users_email_idx",
          unique: true,
          detail: "CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)",
        },
      ],
    );
    expect(ddl).toContain("CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email);");
  });

  it("reconstructs MySQL/SQLite simple index columns and skips managed indexes", () => {
    const ddl = buildTableDdl(
      "mysql",
      "users",
      [{ name: "email", dataType: "varchar(255)", nullable: false, isPrimaryKey: false }],
      [],
      [
        { name: "PRIMARY", unique: true, detail: "id" },
        { name: "idx_users_email", unique: false, detail: "email" },
      ],
    );
    expect(ddl).not.toContain("INDEX `PRIMARY`");
    expect(ddl).toContain("CREATE INDEX `idx_users_email` ON `users` (`email`);");
  });
  it("restores defaults, generated expressions and PostgreSQL comments", () => {
    const ddl = buildTableDdl(
      "postgres",
      "users",
      [
        {
          name: "created_at",
          dataType: "timestamp with time zone",
          nullable: false,
          isPrimaryKey: false,
          defaultValue: "now()",
        },
        {
          name: "slug",
          dataType: "text",
          nullable: true,
          isPrimaryKey: false,
          generated: "lower(name)",
          comment: "Normalized display name",
        },
      ],
    );

    expect(ddl).toContain('"created_at" timestamp with time zone DEFAULT now() NOT NULL');
    expect(ddl).toContain('"slug" text GENERATED ALWAYS AS (lower(name)) STORED');
    expect(ddl).toContain(
      'COMMENT ON COLUMN "users"."slug" IS \'Normalized display name\';',
    );
  });

  it("quotes MySQL string defaults and comments without quoting numeric defaults", () => {
    const ddl = buildTableDdl(
      "mysql",
      "profiles",
      [
        {
          name: "label",
          dataType: "varchar(80)",
          nullable: false,
          isPrimaryKey: false,
          defaultValue: "guest",
          comment: "user's label",
        },
        {
          name: "rank",
          dataType: "int unsigned",
          nullable: false,
          isPrimaryKey: false,
          defaultValue: "0",
        },
      ],
    );

    expect(ddl).toContain("`label` varchar(80) DEFAULT 'guest' NOT NULL COMMENT 'user''s label'");
    expect(ddl).toContain("`rank` int unsigned DEFAULT 0 NOT NULL");
  });

  it("marks SQLite generated columns whose expression cannot be recovered", () => {
    const ddl = buildTableDdl(
      "sqlite",
      "metrics",
      [
        {
          name: "total",
          dataType: "REAL",
          nullable: true,
          isPrimaryKey: false,
          generated: "VIRTUAL (expression unavailable)",
        },
      ],
    );

    expect(ddl).toContain("-- Generated columns requiring manual review");
    expect(ddl).toContain("SQLite metadata does not expose the original expression");
  });

});
