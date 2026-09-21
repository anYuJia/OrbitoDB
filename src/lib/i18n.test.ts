import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale, toggleLocale, translate } from "./i18n";

describe("i18n", () => {
  afterEach(() => {
    setLocale("en-US");
  });

  it("switches between English and Simplified Chinese", () => {
    setLocale("en-US");
    expect(translate("top.search")).toBe("Search");

    setLocale("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    expect(translate("top.search")).toBe("搜索");
  });

  it("interpolates translated variables", () => {
    setLocale("zh-CN");
    expect(translate("cmd.connectTo", { name: "Local PG" })).toBe("连接 — Local PG");
    expect(translate("status.rows", { count: 12 })).toBe("12 行");
  });

  it("toggles locale deterministically", () => {
    setLocale("en-US");
    toggleLocale();
    expect(getLocale()).toBe("zh-CN");
    toggleLocale();
    expect(getLocale()).toBe("en-US");
  });
});
