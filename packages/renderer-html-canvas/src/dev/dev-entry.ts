/**
 * 本地开发入口（仅 dev server，不进生产 dist）：dev.html?board=<目录名>
 *
 * 把 fixtures/<目录名>/ 当作一块已上传的画板：按预览站同样的形状注入
 * window.__PRD_LAB_RENDERER_CONFIG__（dataBaseUrl 指向 dev server 的 /__fixtures/<目录名>/，
 * __computed 由生产同一 computeMetadata 算出），再加载生产入口 main.tsx。
 * 数据源见 vite.config.ts 的 devFixtures 插件。
 */
import type { RendererConfig } from "../types";

async function boot() {
  const rootEl = document.getElementById("root")!;
  const board = new URLSearchParams(window.location.search).get("board");
  if (!board) {
    const boards = (await fetch("/__fixtures/").then((r) => r.json())) as string[];
    rootEl.innerHTML =
      `<div class="hc-fatal">dev 入口需要 ?board=&lt;fixtures 目录名&gt;<br/><br/>` +
      boards.map((b) => `<a href="?board=${encodeURIComponent(b)}">${b}</a>`).join("<br/>") +
      `</div>`;
    return;
  }

  const base = `/__fixtures/${encodeURIComponent(board)}/`;
  const res = await fetch(`${base}__meta.json`);
  if (!res.ok) {
    rootEl.innerHTML = `<div class="hc-fatal">fixtures/${board}/ 不存在或缺少 canvas.json</div>`;
    return;
  }
  const config: RendererConfig = {
    schemaVersion: 1,
    snapshotId: `dev-${board}`,
    dataBaseUrl: base,
    entryHtmlPath: "index.html",
    rendererMetadata: { schemaVersion: 1, __computed: await res.json() },
  };
  window.__PRD_LAB_RENDERER_CONFIG__ = config;
  await import("../main");
}

void boot();
