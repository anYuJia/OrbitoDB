import { describe, expect, it } from "vitest";
import { primaryModifierLabel, shortcutLabel } from "./platform";

describe("platform shortcut labels", () => {
  it("uses a valid desktop primary modifier", () => {
    expect(["⌘", "Ctrl"]).toContain(primaryModifierLabel());
  });

  it("renders shortcut labels without hard-coding macOS", () => {
    const label = shortcutLabel("K");
    expect(label === "⌘K" || label === "Ctrl+K").toBe(true);
  });
});
