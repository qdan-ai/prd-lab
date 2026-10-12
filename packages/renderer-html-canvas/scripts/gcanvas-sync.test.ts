import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * gcanvas-sync 脚本单测：临时目录里造一个假上游仓库 + 一个假查看器包（脚本按自身位置定位清单），
 * 验证 sync 写入逐字件、check 对各类漂移报红（非零退出）并说明处理方式。
 */

const SCRIPT = resolve(__dirname, "gcanvas-sync.mjs");
const REAL_REPO = resolve(__dirname, "../../../../html_canvas");

let tmp: string;
let up: string;
let pkg: string;

function git(...args: string[]) {
  execFileSync("git", ["-C", up, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdio: "ignore" });
}

function writeUp(rel: string, content: string) {
  const p = join(up, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function commitUp(msg: string) {
  git("add", "-A");
  git("commit", "-q", "-m", msg);
}

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [join(pkg, "scripts/gcanvas-sync.mjs"), ...args], {
    encoding: "utf8",
    env: { ...process.env, GCANVAS_REPO: "" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gcanvas-sync-"));
  up = join(tmp, "upstream");
  pkg = join(tmp, "pkg");
  mkdirSync(up);
  execFileSync("git", ["init", "-q", up]);
  writeUp("viewer/src/engine/geo.ts", "import { parse } from 'parse5'\nexport const k = 1\n");
  writeUp("viewer/package.json", JSON.stringify({ dependencies: { parse5: "^8.0.1", unused: "^1.0.0" } }));
  writeUp("viewer/src/ui/canvas/renderers/AView.tsx", "import { k } from '../../../engine/geo'\nexport const A = k\n");
  writeUp("viewer/src/ui/canvas/canvas-context.ts", "export interface Ctx { zoom: number }\n");
  commitUp("init");

  mkdirSync(join(pkg, "scripts"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ dependencies: { parse5: "^8.0.1" } }));
  copyFileSync(SCRIPT, join(pkg, "scripts/gcanvas-sync.mjs"));
  mkdirSync(join(pkg, "src/gcanvas/ui/canvas"), { recursive: true });
  writeFileSync(join(pkg, "src/gcanvas/ui/canvas/canvas-context.ts"), "export interface Ctx { zoom: number }\n");
  const v = (p: string) => ({ upstream: `viewer/src/${p}`, local: `src/gcanvas/${p}`, kind: "verbatim", upstreamSha256: null });
  writeFileSync(
    join(pkg, "gcanvas-sync.json"),
    JSON.stringify({
      upstream: { repo: "fake", commit: "none" },
      files: [
        v("engine/geo.ts"),
        v("ui/canvas/renderers/AView.tsx"),
        { ...v("ui/canvas/canvas-context.ts"), kind: "shim" },
      ],
      watch: [{ dir: "viewer/src/ui/canvas/renderers", exclude: "\\.test\\." }],
      deps: { upstreamPackageJson: "viewer/package.json" },
    }),
  );
  expect(run("sync", "--repo", up).code).toBe(0);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("gcanvas-sync", () => {
  it("sync 逐字写入上游文件，随后 check 通过", () => {
    expect(readFileSync(join(pkg, "src/gcanvas/engine/geo.ts"), "utf8")).toBe("import { parse } from 'parse5'\nexport const k = 1\n");
    const r = run("check", "--repo", up);
    expect(r.code).toBe(0);
    expect(r.out).toContain("一致");
  });

  it("上游改了逐字件 → check 报红；sync 后恢复一致", () => {
    writeUp("viewer/src/engine/geo.ts", "export const k = 2\n");
    commitUp("change geo");
    const r = run("check", "--repo", up);
    expect(r.code).toBe(1);
    expect(r.out).toContain("viewer/src/engine/geo.ts");
    expect(r.out).toContain("上游内容已变");
    expect(r.out).toContain("跑 sync");

    expect(run("sync", "--repo", up).code).toBe(0);
    expect(readFileSync(join(pkg, "src/gcanvas/engine/geo.ts"), "utf8")).toBe("export const k = 2\n");
    expect(run("check", "--repo", up).code).toBe(0);
  });

  it("监视目录出现新渲染器文件 → check 报红；--accept 后记入", () => {
    writeUp("viewer/src/ui/canvas/renderers/NoteView.tsx", "export const N = 1\n");
    writeUp("viewer/src/ui/canvas/renderers/NoteView.test.tsx", "// test\n");
    commitUp("new renderer");
    const r = run("check", "--repo", up);
    expect(r.code).toBe(1);
    expect(r.out).toContain("NoteView.tsx");
    expect(r.out).toContain("新文件");
    expect(r.out).not.toContain("NoteView.test.tsx");

    expect(run("sync", "--repo", up).code).toBe(1);
    expect(run("sync", "--repo", up, "--accept").code).toBe(0);
    expect(run("check", "--repo", up).code).toBe(0);
  });

  it("改写件 / 垫片的对照基准只在 --accept 时推进；报红给出从已对照 commit 起的 diff 命令", () => {
    const manifestPath = join(pkg, "gcanvas-sync.json");
    const shimEntry = () =>
      JSON.parse(readFileSync(manifestPath, "utf8")).files.find((f: { kind: string }) => f.kind === "shim");
    const base = execFileSync("git", ["-C", up, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(shimEntry().reconciledCommit).toBe(base);

    writeUp("viewer/src/engine/geo.ts", "export const k = 5\n");
    writeUp("viewer/src/ui/canvas/canvas-context.ts", "export interface Ctx { zoom: number; extra: string }\n");
    commitUp("geo + ctx");
    const head = execFileSync("git", ["-C", up, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    // 不加 --accept：逐字件推进，垫片基准保持在已对照的 commit
    expect(run("sync", "--repo", up).code).toBe(1);
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).upstream.commit).toBe(head);
    expect(shimEntry().reconciledCommit).toBe(base);
    const r = run("check", "--repo", up);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`diff ${base.slice(0, 7)} ${head.slice(0, 7)} -- viewer/src/ui/canvas/canvas-context.ts`);

    expect(run("sync", "--repo", up, "--accept").code).toBe(0);
    expect(shimEntry().reconciledCommit).toBe(head);
  });

  it("本地逐字件被手改 → check 报红", () => {
    writeFileSync(join(pkg, "src/gcanvas/engine/geo.ts"), "export const k = 99\n");
    const r = run("check", "--repo", up);
    expect(r.code).toBe(1);
    expect(r.out).toContain("手改");
  });

  it("垫片对应的上游文件变了 → check 报红，sync 不覆盖垫片", () => {
    writeUp("viewer/src/ui/canvas/canvas-context.ts", "export interface Ctx { zoom: number; extra: string }\n");
    commitUp("ctx");
    const r = run("check", "--repo", up);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[垫片]");
    expect(run("sync", "--repo", up).code).toBe(1);
    expect(readFileSync(join(pkg, "src/gcanvas/ui/canvas/canvas-context.ts"), "utf8")).toBe(
      "export interface Ctx { zoom: number }\n",
    );
  });

  it("逐字件新增了清单外的相对依赖 → check 报红", () => {
    writeUp("viewer/src/engine/geo.ts", "export { m as k } from './more'\n");
    writeUp("viewer/src/engine/more.ts", "export const m = 1\n");
    commitUp("dep");
    expect(run("sync", "--repo", up).code).toBe(1);
    const r = run("check", "--repo", up);
    expect(r.code).toBe(1);
    expect(r.out).toContain("./more");
  });

  it("--commit 指定历史版本比对", () => {
    writeUp("viewer/src/engine/geo.ts", "export const k = 3\n");
    commitUp("later");
    expect(run("check", "--repo", up).code).toBe(1);
    expect(run("check", "--repo", up, "--commit", "HEAD~1").code).toBe(0);
  });

  it("清单写坏 / kind 拼错 → 人话报错，退出码 2", () => {
    const manifestPath = join(pkg, "gcanvas-sync.json");
    const good = readFileSync(manifestPath, "utf8");
    writeFileSync(manifestPath, good.slice(0, -5));
    let r = run("check", "--repo", up);
    expect(r.code).toBe(2);
    expect(r.out).toContain("不是合法 JSON");
    expect(r.out).not.toMatch(/\n\s+at /);

    writeFileSync(manifestPath, good.replace('"kind": "shim"', '"kind": "shmi"'));
    r = run("check", "--repo", up);
    expect(r.code).toBe(2);
    expect(r.out).toContain('"shmi"');
  });

  it("逐字件引用的 npm 包声明版本与上游不同 → 只提示，不影响退出码", () => {
    expect(run("check", "--repo", up).out).not.toContain("提示");
    writeUp("viewer/package.json", JSON.stringify({ dependencies: { parse5: "^9.0.0", unused: "^2.0.0" } }));
    commitUp("bump parse5");
    const r = run("check", "--repo", up);
    expect(r.code).toBe(0);
    expect(r.out).toContain("parse5：上游声明 ^9.0.0，本包声明 ^8.0.1");
    expect(r.out).not.toContain("unused");
  });

  it("找不到上游仓库（未显式指定）→ 打印跳过并以 0 退出", () => {
    const r = spawnSync(process.execPath, [join(pkg, "scripts/gcanvas-sync.mjs"), "check"], {
      encoding: "utf8",
      env: { ...process.env, GCANVAS_REPO: join(tmp, "nope") },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("跳过");
  });
});

describe.skipIf(!existsSync(REAL_REPO))("真实清单", () => {
  it("本地文件与清单记录的上游 commit 一致", () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, "../gcanvas-sync.json"), "utf8"));
    const r = spawnSync(process.execPath, [SCRIPT, "check", "--repo", REAL_REPO, "--commit", manifest.upstream.commit], {
      encoding: "utf8",
    });
    expect(r.stdout + r.stderr).toContain("一致");
    expect(r.status).toBe(0);
  });
});
