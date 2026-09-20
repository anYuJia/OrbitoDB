import { describe, expect, it } from "vitest";
import {
  buildColumnAlterPlan,
  buildConstraintAddSql,
  buildConstraintDropSql,
  buildSqliteRebuildSql,
  isSafeSqlFragment,
} from "./schemaChanges";

describe("schemaChanges", () => {
  it("builds PostgreSQL column property changes as discrete ALTER statements", () => {
    const plan = buildColumnAlterPlan(
      "postgres",
      "users",
      {
        name: "nickname",
        dataType: "text",
        nullable: true,
        isPrimaryKey: false,
        defaultValue: null,
        comment: null,
      },
      {
        name: "display_name",
        dataType: "varchar(80)",
        nullable: false,
        defaultValue: "'guest'",
        comment: "Public label",
      },
    );

    expect(plan.requiresReview).toBe(false);
    expect(plan.statements).toEqual([
      'ALTER TABLE "users" RENAME COLUMN "nickname" TO "display_name";',
      'ALTER TABLE "users" ALTER COLUMN "display_name" TYPE varchar(80);',
      'ALTER TABLE "users" ALTER COLUMN "display_name" SET NOT NULL;',
      'ALTER TABLE "users" ALTER COLUMN "display_name" SET DEFAULT \'guest\';',
      'COMMENT ON COLUMN "users"."display_name" IS \'Public label\';',
    ]);
  });

  it("preserves MySQL auto_increment, on-update and comments when modifying a column", () => {
    const auto = buildColumnAlterPlan(
      "mysql",
      "users",
      {
        name: "id",
        dataType: "bigint unsigned",
        nullable: false,
        isPrimaryKey: true,
        defaultValue: null,
        extra: "auto_increment",
      },
      {
        name: "id",
        dataType: "bigint unsigned",
        nullable: false,
        defaultValue: null,
        comment: "Primary id",
      },
    );
    expect(auto.statements[0]).toContain("AUTO_INCREMENT");
    expect(auto.statements[0]).toContain("COMMENT 'Primary id'");

    const timestamp = buildColumnAlterPlan(
      "mysql",
      "events",
      {
        name: "updated_at",
        dataType: "timestamp",
        nullable: false,
        isPrimaryKey: false,
        defaultValue: "CURRENT_TIMESTAMP",
        extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP",
      },
      {
        name: "updated_at",
        dataType: "timestamp",
        nullable: false,
        defaultValue: "CURRENT_TIMESTAMP",
        comment: null,
      },
    );
    expect(timestamp.statements[0]).toContain("DEFAULT CURRENT_TIMESTAMP");
    expect(timestamp.statements[0]).toContain("ON UPDATE CURRENT_TIMESTAMP");
  });

  it("keeps generated MySQL columns generated", () => {
    const plan = buildColumnAlterPlan(
      "mysql",
      "metrics",
      {
        name: "total",
        dataType: "decimal(10,2)",
        nullable: true,
        isPrimaryKey: false,
        generated: "price * quantity",
        extra: "STORED GENERATED",
      },
      {
        name: "total",
        dataType: "decimal(12,2)",
        nullable: true,
        defaultValue: null,
        comment: null,
      },
    );
    expect(plan.statements[0]).toContain("GENERATED ALWAYS AS (price * quantity) STORED");
  });

  it("rejects unsafe fragments and identity default changes", () => {
    expect(isSafeSqlFragment("varchar(255)")).toBe(true);
    expect(isSafeSqlFragment("text; drop table users")).toBe(false);
    expect(() =>
      buildColumnAlterPlan(
        "postgres",
        "users",
        {
          name: "id",
          dataType: "bigint",
          nullable: false,
          isPrimaryKey: true,
          defaultValue: null,
          extra: "IDENTITY ALWAYS",
        },
        {
          name: "id",
          dataType: "bigint",
          nullable: false,
          defaultValue: "1",
          comment: null,
        },
      ),
    ).toThrow(/identity/i);
  });

  it("builds constraint add/drop syntax per engine", () => {
    expect(buildConstraintAddSql("postgres", "users", "unique", "users_email_key", ["email"])).toBe(
      'ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");',
    );
    expect(buildConstraintAddSql("mysql", "users", "primary", null, ["id"])).toBe(
      "ALTER TABLE `users` ADD PRIMARY KEY (`id`);",
    );
    expect(buildConstraintAddSql("mysql", "users", "check", "age_positive", [], "age >= 0")).toBe(
      "ALTER TABLE `users` ADD CONSTRAINT `age_positive` CHECK (age >= 0);",
    );
    expect(
      buildConstraintDropSql("mysql", "users", {
        name: "users_email_key",
        kind: "unique",
        definition: "UNIQUE (email)",
        columns: ["email"],
      }),
    ).toBe("ALTER TABLE `users` DROP INDEX `users_email_key`;");
  });

  it("produces a review-first SQLite rebuild instead of unsupported ALTER", () => {
    const plan = buildColumnAlterPlan(
      "sqlite",
      "users",
      { name: "age", dataType: "INTEGER", nullable: true, isPrimaryKey: false },
      { name: "age", dataType: "REAL", nullable: false, defaultValue: "0", comment: null },
    );
    expect(plan.requiresReview).toBe(true);

    const sql = buildSqliteRebuildSql(
      "users",
      [
        { name: "id", dataType: "INTEGER", nullable: false, isPrimaryKey: true },
        { name: "age", dataType: "INTEGER", nullable: true, isPrimaryKey: false },
      ],
      "age",
      { name: "age", dataType: "REAL", nullable: false, defaultValue: "0", comment: null },
      [],
      [],
      [],
    );
    expect(sql).toContain("PRAGMA foreign_keys=OFF;");
    expect(sql).toContain('CREATE TABLE "__orbitodb_rebuild_users"');
    expect(sql).toContain('"age" REAL DEFAULT 0 NOT NULL');
    expect(sql).toContain('ALTER TABLE "__orbitodb_rebuild_users" RENAME TO "users";');
  });
});
