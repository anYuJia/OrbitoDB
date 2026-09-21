import { describe, expect, it } from "vitest";
import { buildMaintenancePlan } from "./maintenance";

describe("maintenance", () => {
  it("builds PostgreSQL analyze and vacuum-analyze plans", () => {
    expect(buildMaintenancePlan("postgres", "analyze", "order items").sql).toBe(
      'ANALYZE "order items";',
    );
    expect(buildMaintenancePlan("postgres", "optimize", "users").sql).toBe(
      'VACUUM (ANALYZE) "users";',
    );
  });

  it("builds MySQL analyze and optimize plans", () => {
    expect(buildMaintenancePlan("mysql", "analyze", "users").sql).toBe(
      "ANALYZE TABLE `users`;",
    );
    expect(buildMaintenancePlan("mysql", "optimize", "users").sql).toBe(
      "OPTIMIZE TABLE `users`;",
    );
  });

  it("builds SQLite analyze, optimize and vacuum plans", () => {
    expect(buildMaintenancePlan("sqlite", "analyze", "users").sql).toBe(
      'ANALYZE "users";',
    );
    expect(buildMaintenancePlan("sqlite", "optimize").sql).toBe("PRAGMA optimize;");
    expect(buildMaintenancePlan("sqlite", "vacuum").sql).toBe("VACUUM;");
  });

  it("requires a table where the engine operation is table-scoped", () => {
    expect(() => buildMaintenancePlan("postgres", "analyze")).toThrow(/Choose a table/i);
    expect(() => buildMaintenancePlan("mysql", "optimize")).toThrow(/Choose a table/i);
  });

  it("does not expose full database vacuum for server engines", () => {
    expect(() => buildMaintenancePlan("postgres", "vacuum", "users")).toThrow(/only exposed for SQLite/i);
  });
});
