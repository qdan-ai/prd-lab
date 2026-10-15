import type { ResolveNotice } from "@prd-lab/core/repo";

/**
 * 仓库查看器外壳（预览站 /r/<pid>/）。
 *
 * 挂载点约定：页面注入 window.__PRD_LAB_REPO__（数据地址、?v= 解析结果），留 #repo-viewer-root；
 * G-canvas 只读成品包接入后，外壳加载它并调用 mountRepoViewer(el, { reader, initialVersion,
 * onVersionChange, capabilities })，reader 用 apiBase 下的 repo.json / files / v 三类地址实现。
 * 成品包接入前，外壳本身渲染一个只列版本的占位视图。
 */

export type RepoShellConfig = {
  apiBase: string;
  repoJson: string;
  initialVersion: string | null;
  notice: ResolveNotice | null;
  versionParam: "v";
};

export type RepoShellVersion = { key: string; number: string | null; name: string | null };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON 放进 <script>：转义 < 防 </script> 截断，转义行分隔符防旧引擎解析错。 */
const scriptJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export function renderRepoShell(input: {
  projectName: string;
  config: RepoShellConfig;
  versions: RepoShellVersion[];
  hasDraft: boolean;
}): string {
  const { config } = input;
  const opened = input.versions.find((v) => v.key === config.initialVersion);
  const openedLabel = opened
    ? `${opened.number ?? ""} ${opened.name ?? ""}`.trim()
    : config.initialVersion && input.hasDraft
      ? "草稿"
      : "（还没有推送任何版本）";
  const noticeHtml = config.notice
    ? `<p class="notice">${escapeHtml(config.notice.requested)} ${
        config.notice.reason === "withdrawn" ? "已被撤回" : "已改号或不存在"
      }，已为你打开 ${escapeHtml(config.notice.openedNumber ?? openedLabel)}</p>`
    : "";
  const list = input.versions
    .map(
      (v) =>
        `<li${v.key === config.initialVersion ? ' class="current"' : ""}>${escapeHtml(v.number ?? v.key.slice(0, 12))} ${escapeHtml(v.name ?? "")}</li>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.projectName)} · PRD-Lab</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;color:#222;background:#fafafa}
main{max-width:640px;margin:64px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 8px}.sub{color:#666;font-size:14px;margin:0 0 24px}
.notice{background:#fff7e6;border:1px solid #f0d199;padding:8px 12px;border-radius:6px;font-size:14px}
ul{padding-left:18px;font-size:14px;line-height:1.8}li.current{font-weight:600}
</style>
<script>window.__PRD_LAB_REPO__=${scriptJson(config)};
(function(){try{var u=new URL(location.href);if(u.searchParams.has("token")){u.searchParams.delete("token");history.replaceState(null,"",u.pathname+u.search+u.hash);}}catch(e){}})();</script>
</head><body>
<div id="repo-viewer-root"><main>
<h1>${escapeHtml(input.projectName)}</h1>
<p class="sub">当前版本：${escapeHtml(openedLabel)} · 查看器即将接入</p>
${noticeHtml}
<ul>${list}</ul>
</main></div>
</body></html>`;
}

export function expiredHtml(): Response {
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>链接已失效</title>
<style>body{font-family:system-ui;text-align:center;padding:80px 20px;color:#444}h1{color:#a00}</style>
</head><body><h1>链接已失效</h1><p>请回到分享链接或主站重新打开。</p></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
