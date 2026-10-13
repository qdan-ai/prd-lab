// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas } from "./Canvas";
import type { CanvasDoc } from "./gcanvas/engine/schema";
import { renderStaticMarkdown } from "./gcanvas/ui/editor-kernel";
import { collectViewerBounds } from "./known-elements";

/**
 * 标注块（note）渲染单测（jsdom）：
 *   1. 卡片结构：wrapper 契约、三色、字号档、宽与最小高
 *   2. 正文接线：notes/*.md 经加载器进缓存，渲染结果等于逐字件 renderStaticMarkdown('full', md)
 *   3. 文件缺失 / 读取失败的提示
 *   4. 安全：脚本、事件属性、javascript:、url( 不进 DOM
 *   5. 同一路径只请求一次
 *   6. 包围盒取显示高 max(h, 实测高)
 *   7. 数据不合 G-canvas 格式（如未知颜色）→ 红色占位卡，不悄悄画错
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OK_MD = [
  "## 标题",
  "",
  "- [ ] 待办一",
  "- [x] 待办二",
  "",
  '<span style="color: #d9363e">红字</span>',
  "",
  "| 列A | 列B |",
  "| --- | --- |",
  "| 1 | 2 |",
].join("\n");

const EVIL_MD = [
  "<script>alert(1)</script>",
  "",
  '<img src=x onerror="alert(1)">',
  "",
  "[x](javascript:alert(1))",
  "",
  '<span style="color: red; background: url(https://example.com/x)">t</span>',
].join("\n");

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("notes/ok.md")) return new Response(OK_MD, { status: 200 });
    if (url.endsWith("notes/evil.md")) return new Response(EVIL_MD, { status: 200 });
    if (url.endsWith("notes/missing.md")) return new Response("nf", { status: 404 });
    if (url.endsWith("notes/broken.md")) return new Response("err", { status: 500 });
    return new Response(url.endsWith(".css") ? "" : "<div>block</div>", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const board = (elements: unknown[]) => ({ title: "note", format: "board/v1", elements }) as unknown as CanvasDoc;

async function render(doc: CanvasDoc) {
  await act(async () => {
    root.render(<Canvas board={doc} baseUrl="/p/test/" boardId="test" />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const note = (over: Record<string, unknown> = {}) => ({
  id: "n",
  type: "note",
  file: "notes/ok.md",
  x: 40,
  y: 60,
  w: 480,
  h: 160,
  ...over,
});

describe("标注块渲染", () => {
  it("卡片结构：wrapper 契约、颜色类、字号变量、宽与最小高", async () => {
    await render(board([note({ color: "blue", sizeTier: "large" })]));
    const wrapper = host.querySelector<HTMLElement>('[data-hc-id="n"][data-hc-type="note"]')!;
    expect(wrapper.getAttribute("style")).toBe("position: absolute; left: 40px; top: 60px;");
    const card = wrapper.querySelector<HTMLElement>(".hc-note.hc-note--blue")!;
    expect(card.style.width).toBe("480px");
    expect(card.style.minHeight).toBe("160px");
    expect(card.style.getPropertyValue("--hc-note-font-size")).toBe("36px");
    expect(host.querySelector(".hc-unknown-el")).toBeNull();
  });

  it("缺省颜色为黄、缺省字号档为 30px", async () => {
    await render(board([note()]));
    const card = host.querySelector<HTMLElement>(".hc-note")!;
    expect(card.classList.contains("hc-note--yellow")).toBe(true);
    expect(card.style.getPropertyValue("--hc-note-font-size")).toBe("30px");
  });

  it("正文接线：与逐字件 renderStaticMarkdown('full') 的输出完全相同", async () => {
    await render(board([note()]));
    const body = host.querySelector<HTMLElement>(".hc-note-body")!;
    expect(body.innerHTML).toBe(renderStaticMarkdown("full", OK_MD));
    expect(body.querySelector("h2")).not.toBeNull();
    expect(body.querySelector('ul[data-type="taskList"] input[type="checkbox"]')).not.toBeNull();
    expect(body.querySelector("span[data-hc-color]")).not.toBeNull();
    expect(body.querySelector("table")).not.toBeNull();
  });

  it("文件缺失 / 读取失败：卡片照画，正文处给提示", async () => {
    await render(
      board([
        note({ id: "m", file: "notes/missing.md" }),
        note({ id: "b", file: "notes/broken.md", y: 300 }),
      ]),
    );
    const missing = host.querySelector<HTMLElement>('[data-hc-id="m"]')!;
    expect(missing.querySelector(".hc-note-problem")!.textContent).toBe("找不到标注文件 notes/missing.md");
    const broken = host.querySelector<HTMLElement>('[data-hc-id="b"]')!;
    expect(broken.querySelector(".hc-note-problem")!.textContent).toBe("标注文件读取失败");
    for (const w of [missing, broken]) {
      const card = w.querySelector<HTMLElement>(".hc-note")!;
      expect(card.style.width).toBe("480px");
      expect(card.style.minHeight).toBe("160px");
    }
  });

  it("安全：脚本、事件属性、javascript:、url( 不进卡片 DOM", async () => {
    await render(board([note({ file: "notes/evil.md" })]));
    const card = host.querySelector<HTMLElement>(".hc-note")!;
    expect(card.querySelector("script")).toBeNull();
    for (const el of [card, ...card.querySelectorAll<HTMLElement>("*")]) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.startsWith("on"), `${el.tagName}.${attr.name}`).toBe(false);
        expect(attr.value.includes("javascript:"), `${el.tagName}.${attr.name}`).toBe(false);
      }
      expect((el.getAttribute("style") ?? "").includes("url("), el.tagName).toBe(false);
    }
  });

  it("两张卡片指向同一路径：只请求一次", async () => {
    await render(board([note({ id: "a" }), note({ id: "b", y: 300 })]));
    const hits = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("notes/ok.md"));
    expect(hits).toHaveLength(1);
    expect(host.querySelectorAll(".hc-note-body")).toHaveLength(2);
  });

  it("包围盒取显示高 max(h, 实测高)", () => {
    const tall = board([note({ measured: { w: 480, h: 300 } })]);
    expect(collectViewerBounds(tall)).toContainEqual({ x: 40, y: 60, w: 480, h: 300 });
    const short = board([note({ measured: { w: 480, h: 100 } })]);
    expect(collectViewerBounds(short)).toContainEqual({ x: 40, y: 60, w: 480, h: 160 });
  });

  it("未知颜色：渲染红色占位卡并写明校验错误，不悄悄画错", async () => {
    await render(board([note({ color: "green" })]));
    const card = host.querySelector<HTMLElement>(".hc-unknown-el.is-invalid")!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("color 取值非法");
    expect(host.querySelector(".hc-note")).toBeNull();
  });
});
