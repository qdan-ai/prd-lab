import type { ResolveNotice } from "@prd-lab/core/repo";
import type { ViewerBundle } from "../../../../lib/gcanvas-viewer";

/**
 * 仓库查看器外壳（预览站 /r/<pid>）。
 *
 * 挂载点约定：页面注入 window.__PRD_LAB_REPO__（数据地址、?v= / ?k= 解析结果、项目访客链接），留 #repo-viewer-root；
 * 有 G-canvas 只读成品包（lib/gcanvas-viewer.ts 的 currentViewerBundle）时，外壳加载它并挂载到 #repo-viewer-root；
 * 没有成品包时渲染一个只列版本的占位视图。
 *
 * 外壳页面样式只写 `html, body { margin: 0; height: 100% }` 与给挂载点的高度，不写元素选择器的全局规则
 * （不分层的页面规则会压过查看器所有样式层）；要放自己的全局样式就改用 iframe 承载查看器。
 */

export type RepoShellConfig = {
  apiBase: string;
  repoJson: string;
  initialVersion: string | null;
  /** 锁版本链接指向的版本已撤回或不存在时 notice.locked = true，且 initialVersion = null */
  notice: ResolveNotice | null;
  versionParam: "v";
  /** 项目访客链接（主站 /share/<链接号>）；没有开放访客链接时为 null。查看器据此拼「复制此版本链接」 */
  shareUrl: string | null;
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
  /** 有成品包时输出查看器胶水（无占位样式）；没有就保持占位页 */
  viewer?: ViewerBundle | null;
}): string {
  const { config } = input;
  const { notice } = config;
  const opened = input.versions.find((v) => v.key === config.initialVersion);
  const openedLabel = opened
    ? `${opened.number ?? ""} ${opened.name ?? ""}`.trim()
    : config.initialVersion && input.hasDraft
      ? "草稿"
      : notice?.locked
        ? "（未打开）"
        : "（还没有推送任何版本）";
  const noticeHtml = !notice
    ? ""
    : notice.locked
      ? `<p class="notice" data-locked="true">这个链接固定指向的版本（${escapeHtml(notice.requested)}）${
          notice.reason === "withdrawn" ? "已被撤回" : "不存在"
        }${notice.openedNumber ? `，当前版本是 ${escapeHtml(notice.openedNumber)}` : ""}</p>`
      : `<p class="notice">${escapeHtml(notice.requested)} ${
          notice.reason === "withdrawn" ? "已被撤回" : "已改号或不存在"
        }，已为你打开 ${escapeHtml(notice.openedNumber ?? openedLabel)}</p>`;
  const list = input.versions
    .map(
      (v) =>
        `<li${v.key === config.initialVersion ? ' class="current"' : ""}>${escapeHtml(v.number ?? v.key.slice(0, 12))} ${escapeHtml(v.name ?? "")}</li>`,
    )
    .join("");

  const configScript = `<script>window.__PRD_LAB_REPO__=${scriptJson(config)};
(function(){try{var u=new URL(location.href);if(u.searchParams.has("token")){u.searchParams.delete("token");history.replaceState(null,"",u.pathname+u.search+u.hash);}}catch(e){}})();</script>`;

  if (input.viewer) return renderViewerShell(input.projectName, configScript, input.viewer);

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
${configScript}
</head><body>
<div id="repo-viewer-root"><main>
<h1>${escapeHtml(input.projectName)}</h1>
<p class="sub">当前版本：${escapeHtml(openedLabel)} · 查看器即将接入</p>
${noticeHtml}
<ul>${list}</ul>
</main></div>
</body></html>`;
}

/**
 * 成品包胶水。成品包导出 fromPrdLabConfig 时用它把注入对象转成查看器选项；
 * 导出里还没有它的早期成品包只挂载查看器本体，换成正式包后不用改外壳。
 */
function renderViewerShell(projectName: string, configScript: string, viewer: ViewerBundle): string {
  const base = `/gcanvas-viewer/${viewer.version}`;
  const entry = `${base}/${viewer.entry}`;
  const css = `${base}/${viewer.css}`;
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(projectName)} · PRD-Lab</title>
<style>html,body{margin:0;height:100%}#repo-viewer-root{height:100vh}</style>
<link rel="stylesheet" href="${escapeHtml(css)}">
${configScript}
</head><body>
<div id="repo-viewer-root"></div>
<script type="module">
import * as viewer from ${scriptJson(entry)}
const cfg = window.__PRD_LAB_REPO__
const host = typeof viewer.fromPrdLabConfig === 'function' ? viewer.fromPrdLabConfig(cfg) : {}
viewer.mountRepoViewer(document.getElementById('repo-viewer-root'), {
  ...host,
  onVersionChange: (v) => {
    const u = new URL(location.href)
    u.searchParams.delete('k')
    u.searchParams.set(cfg.versionParam, v.param)
    history.replaceState(null, '', u)
  },
})
</script>
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
