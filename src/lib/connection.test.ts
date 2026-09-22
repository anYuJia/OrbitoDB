import { describe, expect, it } from "vitest";
import {
  connectionEndpoint,
  managedSqliteNameError,
  parseConnectionPort,
  serverDatabaseNameError,
} from "./connection";

describe("connection validation", () => {
  it("uses engine defaults for an omitted remote port", () => {
    expect(parseConnectionPort("postgres", "")).toEqual({ error: null, value: 5432 });
    expect(parseConnectionPort("mysql", "   ")).toEqual({ error: null, value: 3306 });
    expect(parseConnectionPort("sqlite", "9000")).toEqual({ error: null, value: null });
  });

  it("rejects malformed or out-of-range ports", () => {
    expect(parseConnectionPort("postgres", "54.32").error).toMatch(/whole number/i);
    expect(parseConnectionPort("postgres", "0").error).toMatch(/between 1 and 65535/i);
    expect(parseConnectionPort("mysql", "65536").error).toMatch(/between 1 and 65535/i);
    expect(parseConnectionPort("mysql", "3307")).toEqual({ error: null, value: 3307 });
  });

  it("keeps managed SQLite filenames explicit", () => {
    expect(managedSqliteNameError("analytics_2026")).toBeNull();
    expect(managedSqliteNameError("analytics-prod")).toBeNull();
    expect(managedSqliteNameError("analytics prod")).toMatch(/letters, numbers/i);
    expect(managedSqliteNameError("../private")).toMatch(/letters, numbers/i);
  });

  it("validates portable server database identifiers", () => {
    expect(serverDatabaseNameError("_analytics_2026")).toBeNull();
    expect(serverDatabaseNameError("2026_analytics")).toMatch(/start with a letter/i);
    expect(serverDatabaseNameError("analytics-prod")).toMatch(/underscores/i);
  });

  it("formats a useful endpoint summary", () => {
    expect(connectionEndpoint("postgres", "db.internal", 5433, "analytics")).toBe("db.internal:5433 / analytics");
    expect(connectionEndpoint("sqlite", "", null, "events")).toBe("events");
  });
});
