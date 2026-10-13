import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** 样式入口顺序：与 G-canvas ui/main.tsx 的相对顺序一致（prose → content → rich-text → note），外壳样式压轴 */
describe("main.tsx 样式引入顺序", () => {
  it("依次引入 base / canvas-engine / prose / content / rich-text / note / 外壳 styles", () => {
    const src = readFileSync(resolve(__dirname, "main.tsx"), "utf-8");
    const imports = [...src.matchAll(/^import\s+"(\.[^"]+\.css)";/gm)].map((m) => m[1]);
    expect(imports).toEqual([
      "./gcanvas/ui/styles/base.css",
      "./gcanvas/ui/styles/canvas-engine.css",
      "./gcanvas/ui/styles/prose.css",
      "./gcanvas/ui/styles/content.css",
      "./gcanvas/ui/styles/rich-text.css",
      "./gcanvas/ui/styles/note.css",
      "./styles.css",
    ]);
  });
});
