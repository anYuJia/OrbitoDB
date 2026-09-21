import { beforeEach, describe, expect, it } from "vitest";
import { useDialog } from "./dialog";
import { changesSchema, confirmIfDestructive, isWrite } from "./safety";

describe("SQL safety classification", () => {
  beforeEach(() => useDialog.setState({ current: null }));

  it("finds writes after comments, CTEs, and earlier statements", () => {
    expect(isWrite("-- inspect first\nSELECT 1; DELETE FROM users WHERE id = 1")).toBe(true);
    expect(isWrite("WITH changed AS (UPDATE users SET active = true RETURNING *) SELECT * FROM changed")).toBe(true);
  });

  it("ignores write keywords in strings, comments, and quoted identifiers", () => {
    expect(isWrite("SELECT 'delete from users', \"update\" FROM notes -- DROP TABLE notes")).toBe(false);
    expect(isWrite("SELECT $$ truncate users $$")).toBe(false);
  });

  it("detects real schema changes without matching comments or strings", () => {
    expect(changesSchema("SELECT 1; CREATE TABLE notes (id INTEGER)")).toBe(true);
    expect(changesSchema("CREATE OR REPLACE VIEW active_users AS SELECT 1")).toBe(true);
    expect(changesSchema("SELECT 'DROP TABLE users' -- ALTER TABLE notes")).toBe(false);
  });

  it("asks before a destructive statement later in a script", async () => {
    const pending = confirmIfDestructive("SELECT 1; DROP TABLE users");
    const dialog = useDialog.getState().current;
    expect(dialog?.title).toBe("Run destructive statement?");
    dialog?.resolve(true);
    await expect(pending).resolves.toBe(true);
  });

  it("asks before an unbounded mutation but not one with a WHERE clause", async () => {
    const pending = confirmIfDestructive("SELECT 1; UPDATE users SET active = false");
    const dialog = useDialog.getState().current;
    expect(dialog?.title).toBe("Run without a WHERE clause?");
    dialog?.resolve(false);
    await expect(pending).resolves.toBe(false);

    await expect(confirmIfDestructive("UPDATE users SET active = false WHERE id = 7")).resolves.toBe(true);
  });
});
