import { describe, expect, it } from "vitest";
import { badFilePath } from "./file-path";

describe("badFilePath", () => {
  it.each(["docs/方案...md", "blocks/a..b.html", "a..b/c.html", "blocks/页面 一.html"])("可读：%s", (p) => {
    expect(badFilePath(p)).toBe(false);
  });
  it.each(["..", "../x", "a/../b", "a/..", "a\\b", "a\u0001b", "x".repeat(1025)])("拒绝：%j", (p) => {
    expect(badFilePath(p)).toBe(true);
  });
});
