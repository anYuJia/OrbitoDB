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
});
