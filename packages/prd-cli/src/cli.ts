// 注意：实际执行 shebang 由 build.mjs banner 注入到 dist/cli.js；
// 这里不要写 shebang，否则 esbuild 会与 banner 串成"双 shebang"导致 SyntaxError。
import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { cac } from "cac";
import { ApiClient } from "./lib/api-client";
import { startOAuthFlow } from "./lib/oauth";
import { packDirectoryToZip } from "./lib/packer";
import {
  getUserRcPath,
  projectRcPath,
  readProjectRc,
  readUserRc,
  writeProjectRc,
  writeUserRc,
} from "./lib/rc";
import { resolveProjectVersion, uploadSnapshot } from "./lib/upload";
import { registerListCommands } from "./commands/list";
import { registerProjectCommands } from "./commands/project";
import { registerVersionCommands } from "./commands/version";
import { registerSnapshotCommands } from "./commands/snapshot";
import { registerShareCommands } from "./commands/share";
import { collapseNamespacedArgs } from "./lib/argv-collapse";

// S12 一次性 deprecation：检测到 PRD_MCP_* 旧环境变量给提示但不阻塞
if (Object.keys(process.env).some((k) => k.startsWith("PRD_MCP_"))) {
  console.error(
    "[prd] 注意：检测到 PRD_MCP_* 环境变量。prd-mcp 已在 S12 废弃，请改用 PRD-Lab Skill（详见主站设置页）。",
  );
}

const cli = cac("prd");

// 默认走 nginx :80（生产配置；docs/00 §技术栈 + docker/nginx.conf 一致）。
// 本地 dev（pnpm dev:main 直监 :3000）请用 PRD_ENDPOINT=http://localhost:3000 prd login
// 或 prd login --endpoint http://localhost:3000 覆盖。
const DEFAULT_ENDPOINT = process.env.PRD_ENDPOINT || "http://app.local";

function readClientOrExit(): ApiClient {
  const rc = readUserRc();
  if (!rc) {
    console.error(`未登入。请先跑：prd login`);
    process.exit(1);
  }
  return new ApiClient({ endpoint: rc.endpoint, token: rc.token });
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input, output });
  const hint = defaultValue ? ` (${defaultValue})` : "";
  const ans = (await rl.question(`${question}${hint}: `)).trim();
  rl.close();
  return ans || defaultValue || "";
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

// ---- prd login ----
cli
  .command("login", "通过浏览器授权 CLI 拿 API token")
  .option("--endpoint <url>", "主站地址", { default: DEFAULT_ENDPOINT })
  .action(async (opts: { endpoint: string }) => {
    const { hostname } = await import("node:os");
    console.log(`[prd] 正在请求授权 (${opts.endpoint})...`);
    const { token } = await startOAuthFlow({
      endpoint: opts.endpoint,
      clientHostname: hostname(),
    });
    writeUserRc({ endpoint: opts.endpoint, token });
    console.log(`[prd] 授权成功，token 已写入 ${getUserRcPath()}`);
  });

// ---- prd whoami ----
cli.command("whoami", "显示当前 token 对应用户").action(async () => {
  const client = readClientOrExit();
  const res = await client.get<{ id: string; name: string }>("/api/v1/me");
  if (res.status !== 200 || !res.data) {
    console.error(`[prd] whoami 失败：HTTP ${res.status} ${res.error?.error_code ?? ""}`);
    process.exit(1);
  }
  console.log(`${res.data.name} (${res.data.id})`);
});

// ---- prd doctor ----
cli.command("doctor", "自诊断：rc 文件 / endpoint / token 三项检查").action(async () => {
  let allOk = true;
  function pass(label: string, detail = "") {
    console.log(`  ✓ ${label}${detail ? "  " + detail : ""}`);
  }
  function fail(label: string, hint: string) {
    allOk = false;
    console.log(`  ✗ ${label}\n    → ${hint}`);
  }

  console.log(`[prd doctor]`);
  const rc = readUserRc();
  if (!rc) {
    fail(`~/.prdrc 不存在或字段不全`, "跑 'prd login' 完成 OAuth 授权");
  } else {
    pass(`~/.prdrc 存在`, `(endpoint=${rc.endpoint}, token=${rc.token.slice(0, 12)}…)`);
  }

  if (rc) {
    try {
      const url = new URL("/api/v1/me", rc.endpoint).toString();
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${rc.token}` },
      });
      if (res.ok) {
        const me = (await res.json()) as { name: string; authVia: string };
        pass(`endpoint 可达 + token 有效`, `(${me.name} via ${me.authVia})`);
      } else if (res.status === 401) {
        fail(
          `token 无效或已撤销 (HTTP 401)`,
          "跑 'prd login' 重新授权，或在主站 /settings/tokens 检查 token 列表",
        );
      } else {
        fail(`endpoint 返回 HTTP ${res.status}`, `检查 endpoint 是否正确：${rc.endpoint}`);
      }
    } catch (e) {
      fail(
        `endpoint 不可达：${(e as Error).message}`,
        `确认主站已启动（pnpm dev:main）+ /etc/hosts 含 app.local，或用 PRD_ENDPOINT 覆盖`,
      );
      // 顺手探测 dev :3000，给用户具体建议
      const devUrl = "http://localhost:3000/api/v1/me";
      try {
        await fetch(devUrl, { headers: { authorization: `Bearer ${rc.token}` } });
        console.log(
          `    ℹ dev 模式：localhost:3000 可达，建议 PRD_ENDPOINT=http://localhost:3000 prd doctor`,
        );
      } catch {
        // localhost 也不通 → 主站确实没起
      }
    }
  }

  // 工作目录 .prdrc.json
  const projectRc = readProjectRc(process.cwd());
  if (projectRc) {
    pass(
      `工作目录 .prdrc.json`,
      `(project=${projectRc.projectName} version=${projectRc.versionName})`,
    );
  } else {
    console.log(`  ℹ 当前目录无 .prdrc.json（push 时会交互引导生成）`);
  }

  console.log(allOk ? `\n[prd doctor] ✓ 一切正常` : `\n[prd doctor] ✗ 存在问题，按上方建议修复`);
  if (!allOk) process.exit(1);
});

// ---- prd auth list ----
cli.command("auth list", "列出活跃 API token").action(async () => {
  const client = readClientOrExit();
  const res = await client.get<
    Array<{ id: string; name: string; tokenPrefix: string; lastUsedAt: string | null; createdAt: string }>
  >("/api/v1/cli/tokens");
  if (res.status !== 200 || !res.data) {
    console.error(`[prd] 拉取失败：HTTP ${res.status}`);
    process.exit(1);
  }
  if (res.data.length === 0) {
    console.log("(无活跃 token)");
    return;
  }
  for (const t of res.data) {
    const last = t.lastUsedAt ?? "never";
    console.log(`${t.id}  ${t.tokenPrefix}…  "${t.name}"  last_used=${last}  created=${t.createdAt}`);
  }
});

// ---- prd auth revoke ----
cli
  .command("auth revoke <tokenId>", "撤销指定 token")
  .action(async (tokenId: string) => {
    const client = readClientOrExit();
    const res = await client.delete(`/api/v1/cli/tokens/${tokenId}`);
    if (res.status === 200) {
      console.log(`[prd] 已撤销 ${tokenId}`);
      return;
    }
    if (res.status === 404) {
      console.error(`[prd] 未找到 token ${tokenId}（或非你拥有）`);
      process.exit(1);
    }
    console.error(`[prd] 撤销失败：HTTP ${res.status}`);
    process.exit(1);
  });

// ---- prd push ----
cli
  .command("push [dir]", "打包并上传原型 zip（默认当前目录）")
  .option("--change-note <text>", "改动说明")
  .option("--auto-note", "自动生成 change_note（auto:{sha}@{ISO}）")
  .option("--project <name>", "覆盖 .prdrc.json projectName")
  .option("--version <name>", "覆盖 .prdrc.json versionName")
  .option("--renderer <name>", "文件预览方法（default / pm-canvas / ...），默认 default")
  .option("--no-interactive", "禁止交互（CI / MCP 场景）")
  .option("--json", "stdout 输出单行 JSON（含 snapshot.id 等下游必需字段）；进度信息走 stderr")
  .action(
    async (
      dir: string | undefined,
      flags: {
        changeNote?: string;
        autoNote?: boolean;
        project?: string;
        version?: string;
        renderer?: string;
        interactive: boolean;
        json?: boolean;
      },
    ) => {
      const client = readClientOrExit();
      // JSON 模式下所有进度信息走 stderr，stdout 留给最终 JSON
      const log = (msg: string) =>
        flags.json ? console.error(msg) : console.log(msg);
      const cwd = resolve(dir ?? ".");
      if (!existsSync(cwd)) {
        console.error(`[prd] 目录不存在：${cwd}`);
        process.exit(1);
      }

      let projectName = flags.project;
      let versionName = flags.version;
      const projectRc = readProjectRc(cwd);
      if (!projectName) projectName = projectRc?.projectName;
      if (!versionName) versionName = projectRc?.versionName;

      if (!projectName || !versionName) {
        if (!flags.interactive) {
          console.error(`[prd] 缺 project/version 且 --no-interactive，建议先建 .prdrc.json`);
          process.exit(1);
        }
        if (!projectName) projectName = await prompt("项目名");
        if (!versionName) versionName = await prompt("方案名", "方案A");
        if (!projectName || !versionName) {
          console.error(`[prd] 必须提供 project + version`);
          process.exit(1);
        }
      }

      log(`[prd] 打包 ${cwd} ...`);
      const pack = await packDirectoryToZip(cwd);
      try {
        log(`[prd] zip ${(pack.size / 1024).toFixed(1)}KB sha256=${shortSha(pack.sha256)}`);

        let changeNote = flags.changeNote;
        if (!changeNote && flags.autoNote) {
          changeNote = `auto:${shortSha(pack.sha256)}@${new Date().toISOString()}`;
        }
        if (!changeNote) {
          if (!flags.interactive) {
            console.error(`[prd] --change-note 必填（或加 --auto-note）`);
            process.exit(1);
          }
          changeNote = await prompt("改动说明");
          if (!changeNote) {
            console.error(`[prd] change_note 不能空`);
            process.exit(1);
          }
        }

        const resolved = await resolveProjectVersion(client, projectName, versionName, {
          autoCreate: true,
        });
        if (resolved.createdProject) log(`[prd] 新建项目 "${resolved.projectName}"`);
        if (resolved.createdVersion) log(`[prd] 新建方案 "${resolved.versionName}"`);

        // 首次 push 落 .prdrc.json
        if (!projectRc) {
          writeProjectRc(cwd, {
            projectName: resolved.projectName,
            versionName: resolved.versionName,
            endpoint: client.endpoint,
          });
          log(`[prd] 已写入 ${projectRcPath(cwd)} (建议加入 .gitignore)`);
          checkGitignore(cwd);
        }

        const result = await uploadSnapshot(client, resolved.versionId, {
          zipPath: pack.zipPath,
          sha256: pack.sha256,
          changeNote,
          uploaderType: "cli",
          renderer: flags.renderer,
        });
        if (result.status >= 400) {
          if (flags.json) {
            console.log(
              JSON.stringify({
                error_code: result.error?.error_code ?? "unknown",
                message: result.error?.message ?? "",
                status: result.status,
              }),
            );
          } else {
            console.error(
              `[prd] 上传失败：HTTP ${result.status} ${result.error?.error_code ?? ""} ${result.error?.message ?? ""}`,
            );
          }
          process.exit(1);
        }

        const snapshot = result.snapshot;
        const summary = {
          snapshot,
          projectId: resolved.projectId,
          projectName: resolved.projectName,
          versionId: resolved.versionId,
          versionName: resolved.versionName,
          duplicateOfActive: result.duplicateOfActive ?? false,
          matchedArchived: result.matchedArchived ?? null,
          createdProject: resolved.createdProject,
          createdVersion: resolved.createdVersion,
          sha256: pack.sha256,
          sizeBytes: pack.size,
          changeNote,
        };

        if (flags.json) {
          console.log(JSON.stringify(summary));
          return;
        }

        if (result.duplicateOfActive) {
          console.log(
            `[prd] 内容未变 (sha256=${shortSha(pack.sha256)})，命中活跃快照 v${snapshot?.seqNo}`,
          );
          if (snapshot?.id) console.log(`[prd] snapshot_id=${snapshot.id}`);
          return;
        }
        if (result.matchedArchived) {
          console.log(`[prd] ⚠ 检测到此内容曾被删除，已新建独立快照`);
        }
        console.log(`[prd] ✓ 上传成功 v${snapshot?.seqNo}`);
        if (snapshot?.id) console.log(`[prd] snapshot_id=${snapshot.id}`);
      } finally {
        pack.cleanup();
      }
    },
  );

// ---- prd export ----
cli
  .command("export <versionId>", "下载导出 zip（含合并评论）")
  .option("-o, --output <path>", "输出文件路径", { default: "./export.zip" })
  .action(async (versionId: string, opts: { output: string }) => {
    const client = readClientOrExit();
    const res = await fetch(`${client.endpoint}/api/v1/exports/${versionId}`, {
      headers: { authorization: `Bearer ${client.token}` },
    });
    if (!res.ok) {
      console.error(`[prd] 导出失败：HTTP ${res.status}`);
      process.exit(1);
    }
    const ab = await res.arrayBuffer();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(opts.output, Buffer.from(ab));
    console.log(`[prd] 已落盘 ${opts.output} (${(ab.byteLength / 1024).toFixed(1)}KB)`);
  });

// S12：注册子命令组（list / project / version / snapshot / share）
registerListCommands(cli);
registerProjectCommands(cli);
registerVersionCommands(cli);
registerSnapshotCommands(cli);
registerShareCommands(cli);

cli.help();
// 全局 version flag 用 --cli-version，避免与 `prd push --version <name>` 撞名
cli.version("0.0.0", "-V, --cli-version");

const multiWordCommandNames = cli.commands
  .map((c) => c.name)
  .filter((n) => n.includes(" "));
// cac 在模块顶层 `const processArgs = process.argv` 捕获了数组引用，
// 必须 in-place 改 process.argv，不能重新赋值，否则 cac 看不到改动。
const collapsed = collapseNamespacedArgs(process.argv, multiWordCommandNames);
process.argv.splice(0, process.argv.length, ...collapsed);

function checkGitignore(cwd: string) {
  const gi = resolve(cwd, ".gitignore");
  if (!existsSync(gi)) return;
  try {
    const content = readFileSync(gi, "utf8");
    if (!/\.prdrc\.json/.test(content)) {
      console.log(`[prd] 提示：建议在 .gitignore 加入 .prdrc.json`);
    }
  } catch {
    // ignore
  }
}

cli.parse();
