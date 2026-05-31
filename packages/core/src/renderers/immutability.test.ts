import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Snapshot renderer 字段不可变性 lint（DESIGN §15.6 / 决策 D12）。
 *
 * snapshot 是 immutable：renderer_name / renderer_metadata 仅在上传 INSERT
 * 时一次性写入，绝不允许后续 UPDATE。该规则用代码层 grep + 数据库层无 UPDATE 路径
 * 双重保障。本测试是代码层守门人。
 *
 * 规则：任何 .ts 文件中，**同一行**既包含 `update(snapshots)` 又包含
 * `rendererName` 或 `rendererMetadata` 字段名 → 测试失败。
 * 多行 set：对**每个** `update(snapshots)` 出现位置，扫其后 800 字符窗口内的
 * `.set(...)` 区段是否含上述字段（renderer-codex-followup Step 7 修复：原实现只看
 * 第一次出现，同文件多次 `update(snapshots)` 时漏检后续 occurrence）。
 * 若未来需要更稳的保障，再升级为 AST 解析。
 *
 * 扫描范围：apps/ + packages/ 下所有 .ts/.tsx；跳过 node_modules / dist /
 * .next / 本测试文件自身。
 */

const REPO_ROOT = resolve(__dirname, "../../../..");
const SCAN_DIRS = ["apps", "packages"];
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-node",
  ".next",
  ".turbo",
  "build",
]);
const SELF_FILE = "immutability.test.ts";

function walkTsFiles(root: string, out: string[]): void {
  // 显式 inline 形状，避开 @types/node 24+ readdirSync 默认 `Dirent<NonSharedBuffer>`
  // 的 Buffer 化推断（让 ent.name.endsWith / isDirectory 都报错）。
  type SimpleDirent = { name: string; isDirectory: () => boolean; isFile: () => boolean };
  let entries: SimpleDirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true }) as unknown as SimpleDirent[];
  } catch {
    return;
  }
  for (const ent of entries) {
    const fullPath = resolve(root, ent.name);
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      walkTsFiles(fullPath, out);
    } else if (ent.isFile()) {
      if (ent.name === SELF_FILE) continue;
      if (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx")) {
        out.push(fullPath);
      }
    }
  }
}

describe("snapshot renderer 字段不可变性 lint", () => {
  it("禁 update(snapshots) 与 rendererName/rendererMetadata 同行", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) {
      walkTsFiles(resolve(REPO_ROOT, dir), files);
    }
    expect(files.length).toBeGreaterThan(0);

    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of files) {
      const content = (() => {
        try {
          return readFileSync(file, "utf-8");
        } catch {
          return "";
        }
      })();
      if (!content.includes("update(snapshots)")) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (
          line.includes("update(snapshots)") &&
          (line.includes("rendererName") || line.includes("rendererMetadata"))
        ) {
          violations.push({ file, line: i + 1, text: line.trim() });
        }
      }
      // 多行 set：扫**所有** update(snapshots) 出现位置；每个位置看其后 800 字符内
      // 的 .set({...}) 区域里有没有这两个字段。原实现只看第一次 occurrence 会漏检
      // 同文件多次 update(snapshots) 的后续位置（renderer-codex-followup Step 7）。
      let searchFrom = 0;
      while (true) {
        const updateIdx = content.indexOf("update(snapshots)", searchFrom);
        if (updateIdx < 0) break;
        const window = content.slice(updateIdx, updateIdx + 800);
        if (
          window.includes(".set(") &&
          (window.includes("rendererName") || window.includes("rendererMetadata"))
        ) {
          const prefix = content.slice(0, updateIdx);
          const startLine = prefix.split("\n").length;
          violations.push({
            file,
            line: startLine,
            text: `update(snapshots) ... .set({ ...rendererName|rendererMetadata }) in window`,
          });
        }
        searchFrom = updateIdx + "update(snapshots)".length;
      }
    }

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `snapshot 字段不可变性违规：renderer_name / renderer_metadata 只允许 INSERT，禁止 UPDATE。\n${detail}`,
      );
    }
  });
});
