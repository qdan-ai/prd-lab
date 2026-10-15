import { describe, expect, it } from "vitest";
import { renderRepoShell, type RepoShellConfig } from "./shell";

const config: RepoShellConfig = {
  apiBase: "/r/p1",
  repoJson: "/r/p1/repo.json",
  initialVersion: "k1",
  notice: null,
  versionParam: "v",
  shareUrl: null,
};
const base = { projectName: "项目 <A>", config, versions: [{ key: "k1", number: "v1.0", name: "首版" }], hasDraft: false };
const viewer = { version: "abc12345", entry: "gcanvas-viewer.js", css: "gcanvas-viewer.css" };

describe("renderRepoShell", () => {
  it("有成品包：输出样式表与模块胶水，页面样式只有 html/body 与挂载点高度，没有占位页规则", () => {
    const html = renderRepoShell({ ...base, viewer });
    expect(html).toContain('<link rel="stylesheet" href="/gcanvas-viewer/abc12345/gcanvas-viewer.css">');
    expect(html).toContain('"/gcanvas-viewer/abc12345/gcanvas-viewer.js"');
    expect(html).toContain("mountRepoViewer(document.getElementById('repo-viewer-root')");
    expect(html).toContain("viewer.fromPrdLabConfig");
    expect(html).toContain("onVersionChange");
    expect(html).toContain("u.searchParams.delete('k')");
    expect(html).toContain("u.searchParams.set(cfg.versionParam, v.param)");
    expect(html).toContain("history.replaceState(null, '', u)");
    expect(html).toContain("window.__PRD_LAB_REPO__=");
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    expect(styles).toEqual(["html,body{margin:0;height:100%}#repo-viewer-root{height:100vh}"]);
    for (const rule of ["body{font", "h1{", "ul{", "li.", "main{"]) expect(html).not.toContain(rule);
    expect(html).not.toContain("查看器即将接入");
    expect(html).toContain("项目 &lt;A&gt;");
  });

  it("没有成品包：占位页照旧（版本列表、占位样式、没有胶水）", () => {
    for (const viewerArg of [undefined, null]) {
      const html = renderRepoShell({ ...base, viewer: viewerArg });
      expect(html).toContain("查看器即将接入");
      expect(html).toContain("body{font-family");
      expect(html).toContain('<li class="current">v1.0 首版</li>');
      expect(html).toContain('<div id="repo-viewer-root"><main>');
      expect(html).not.toContain("/gcanvas-viewer/");
      expect(html).not.toContain("mountRepoViewer");
      expect(html).toContain("window.__PRD_LAB_REPO__=");
    }
  });

  it("两种形态都带 token 清理脚本与注入对象", () => {
    for (const v of [viewer, null]) {
      const html = renderRepoShell({ ...base, viewer: v });
      expect(html).toContain('searchParams.delete("token")');
      expect(html).toContain('"initialVersion":"k1"');
    }
  });
});
