import { describe, expect, it } from "vitest";
import { buildDuplicateProjection } from "./duplicateRow";

describe("duplicateRow", () => {
  it("omits SQLite INTEGER primary keys so SQLite can generate a new rowid", () => {
    const projection = buildDuplicateProjection(
      "sqlite",
      [
        { name: "id", dataType: "INTEGER", nullable: false, isPrimaryKey: true },
        { name: "name", dataType: "TEXT", nullable: false, isPrimaryKey: false },
      ],
      ["id", "name"],
      [7, "Ada"],
    );
    expect(projection.columns).toEqual(["name"]);
    expect(projection.values).toEqual(["Ada"]);
    expect(projection.omitted).toEqual(["id"]);
  });

  it("omits PostgreSQL identity/default primary keys and generated columns", () => {
    const projection = buildDuplicateProjection(
      "postgres",
      [
        {
          name: "id",
          dataType: "bigint",
          nullable: false,
          isPrimaryKey: true,
          extra: "IDENTITY BY DEFAULT",
        },
        { name: "email", dataType: "text", nullable: false, isPrimaryKey: false },
        {
          name: "slug",
          dataType: "text",
          nullable: false,
          isPrimaryKey: false,
          generated: "lower(email)",
        },
      ],
      ["id", "email", "slug"],
      [9, "USER@example.com", "user@example.com"],
    );
    expect(projection.columns).toEqual(["email"]);
    expect(projection.values).toEqual(["USER@example.com"]);
    expect(projection.omitted).toEqual(["id", "slug"]);
  });

  it("omits MySQL AUTO_INCREMENT keys", () => {
    const projection = buildDuplicateProjection(
      "mysql",
      [
        {
          name: "id",
          dataType: "bigint",
          nullable: false,
          isPrimaryKey: true,
          extra: "auto_increment",
        },
        { name: "label", dataType: "varchar(64)", nullable: true, isPrimaryKey: false },
      ],
      ["id", "label"],
      [3, "copy me"],
    );
    expect(projection.columns).toEqual(["label"]);
    expect(projection.values).toEqual(["copy me"]);
  });

  it("refuses to guess manually assigned primary keys", () => {
    expect(() =>
      buildDuplicateProjection(
        "postgres",
        [
          { name: "code", dataType: "text", nullable: false, isPrimaryKey: true },
          { name: "value", dataType: "text", nullable: true, isPrimaryKey: false },
        ],
        ["code", "value"],
        ["A-1", "hello"],
      ),
    ).toThrow(/manually assigned primary key/i);
  });
});
