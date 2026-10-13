// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas } from "./Canvas";
import { resolveArrowGeometry } from "./gcanvas/engine/arrow-geometry";
import { fitToContent } from "./gcanvas/engine/camera";
import { validateCanvasDoc, type ArrowElement, type CanvasDoc } from "./gcanvas/engine/schema";
import {
  RENDERED_TYPES,
  UNKNOWN_PLACEHOLDER_H,
  UNKNOWN_PLACEHOLDER_W,
  collectViewerBounds,
} from "./known-elements";

/**
 * 查看器画布渲染单测（jsdom）：
 *   1. 七类元素经逐字复制的 G-canvas 渲染器各渲染出带 data-hc-type 的节点（DOM 契约）
 *   2. 画不了的元素（未接入的类型 / 不符合 G-canvas 格式的数据）渲染占位卡、不抛错，并计入框选全部
 *   3. 上游 demo 画板的包围盒全为有限数
 *   4. 元素类型分派覆盖上游 schema 的全部 ElementType
 *   5. 块实测尺寸写回内存 store 后，绑定到块的箭头按上游逻辑重算贴边
 *   6. 打开时自动框选全部
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = resolve(__dirname, "../fixtures");
const loadBoard = (dir: string): CanvasDoc => JSON.parse(readFileSync(resolve(FIXTURES, dir, "canvas.json"), "utf-8"));
const loadDemo = () => loadBoard("gcanvas-demo-board");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // 块 / 共享样式请求：返回最小 HTML / CSS（只验渲染结构，不验块内容）
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(url.endsWith(".css") ? "" : "<div>block</div>", { status: 200 })),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(board: CanvasDoc) {
  await act(async () => {
    root.render(<Canvas board={board} baseUrl="/p/test/" boardId="test" />);
  });
  // 等块的异步 fetch → shadow 注入落定
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Canvas 渲染（G-canvas 逐字件）", () => {
  it("七类元素各渲染出带 data-hc-type 的节点，按数组序、组装在 .hc-stage > .hc-world 内", async () => {
    // demo 画板是上游的六类样例；补一张标注覆盖第七类（标注细节见 note.test.tsx）
    const demo = loadDemo();
    const board = {
      ...demo,
      elements: [...demo.elements, { id: "note1", type: "note", file: "notes/a.md", x: 0, y: 0, w: 300, h: 120 }],
    } as unknown as CanvasDoc;
    await render(board);

    const world = host.querySelector(".hc-stage > .hc-world");
    expect(world).not.toBeNull();
    for (const type of Object.keys(RENDERED_TYPES)) {
      expect(world!.querySelector(`[data-hc-type="${type}"]`), type).not.toBeNull();
    }
    const ids = [...world!.querySelectorAll("[data-hc-id]")].map((n) => n.getAttribute("data-hc-id"));
    expect(ids).toEqual(board.elements.map((e) => e.id));
    expect(host.querySelector(".hc-unknown-el")).toBeNull();
  });

  it("非箭头 wrapper 只有 position/left/top；箭头自定位不套 wrapper", async () => {
    const board = loadDemo();
    await render(board);
    const shape = host.querySelector<HTMLElement>('[data-hc-id="s1"]')!;
    expect(shape.className).toBe("hc-el");
    const s1 = board.elements.find((e) => e.id === "s1") as { x: number; y: number };
    expect(shape.getAttribute("style")).toBe(`position: absolute; left: ${s1.x}px; top: ${s1.y}px;`);
    const arrow = host.querySelector<HTMLElement>('[data-hc-id="a1"]')!;
    expect(arrow.className).toBe("hc-arrow");
  });

  it("文本内容按 Markdown 静态渲染", async () => {
    const board: CanvasDoc = {
      title: "md",
      format: "board/v1",
      elements: [{ id: "t", type: "text", x: 0, y: 0, text: "**加粗** 与 ==高亮==", fontSize: 16 }],
    };
    await render(board);
    const text = host.querySelector('[data-hc-id="t"] .hc-text.hc-md')!;
    expect(text.querySelector("strong")?.textContent).toBe("加粗");
    expect(text.querySelector("mark")?.textContent).toBe("高亮");
  });

  it("未知元素类型渲染可见占位卡（写明类型名），不抛错，其余元素照常渲染", async () => {
    const board = {
      title: "unknown",
      format: "board/v1",
      elements: [
        { id: "s", type: "shape", shape: "rect", x: 0, y: 0, w: 100, h: 50 },
        { id: "n1", type: "rich-note", x: 10, y: 20, w: 300, h: 120, file: "notes/a.md" },
        { id: "n2", type: "sticker" },
      ],
    } as unknown as CanvasDoc;
    await render(board);

    const n1 = host.querySelector<HTMLElement>('[data-hc-id="n1"]')!;
    expect(n1.getAttribute("data-hc-type")).toBe("rich-note");
    expect(n1.style.left).toBe("10px");
    expect(n1.style.top).toBe("20px");
    const card = n1.querySelector<HTMLElement>(".hc-unknown-el")!;
    expect(card.textContent).toContain("rich-note");
    expect(card.style.width).toBe("300px");
    expect(card.style.height).toBe("120px");

    const n2card = host.querySelector<HTMLElement>('[data-hc-id="n2"] .hc-unknown-el')!;
    expect(n2card.style.width).toBe(`${UNKNOWN_PLACEHOLDER_W}px`);
    expect(host.querySelector('[data-hc-type="shape"]')).not.toBeNull();
  });

  it("不符合 G-canvas 格式的元素渲染出错占位卡（写明校验错误），画板其余元素照常显示", async () => {
    const board = {
      title: "bad",
      format: "board/v1",
      elements: [
        { id: "s", type: "shape", shape: "rect", x: 0, y: 0, w: 100, h: 50 },
        { id: "a", type: "arrow", label: "无端点" },
      ],
    } as unknown as CanvasDoc;
    await render(board);
    const card = host.querySelector<HTMLElement>('[data-hc-id="a"] .hc-unknown-el.is-invalid')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("arrow");
    expect(card.textContent).toContain("points");
    expect(host.querySelectorAll(".hc-unknown-el")).toHaveLength(1);
    expect(host.querySelector('[data-hc-id="s"] .hc-shape')).not.toBeNull();
    for (const r of collectViewerBounds(board)) expect(Number.isFinite(r.x + r.y + r.w + r.h)).toBe(true);
  });
});

describe("首屏框选全部", () => {
  it("视口有尺寸时，打开即按 G-canvas fitToContent 把全部元素框进视口", async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const restore = ["clientWidth", "clientHeight"].map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
    const isStage = (el: HTMLElement) => el.classList.contains("hc-stage");
    Object.defineProperty(proto, "clientWidth", { configurable: true, get() { return isStage(this as HTMLElement) ? 1000 : 0; } });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get() { return isStage(this as HTMLElement) ? 800 : 0; } });
    try {
      const board = loadDemo();
      await render(board);
      const cam = fitToContent(collectViewerBounds(board), { w: 1000, h: 800 });
      expect(cam.zoom).not.toBe(1);
      const world = host.querySelector<HTMLElement>(".hc-world")!;
      expect(world.style.transform).toBe(`translate(${cam.tx}px, ${cam.ty}px) scale(${cam.zoom})`);
    } finally {
      for (const [k, d] of restore) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    }
  });
});

describe("measured 写回", () => {
  it("HTML 块渲染出实测尺寸后，绑定到它的箭头按实测盒重算端点", async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const restore = ["offsetWidth", "offsetHeight"].map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
    // jsdom 无布局：让块宿主量出 400×300（其余节点照旧 0）
    Object.defineProperty(proto, "offsetWidth", { configurable: true, get() { return (this as HTMLElement).classList.contains("hc-html-host") ? 400 : 0; } });
    Object.defineProperty(proto, "offsetHeight", { configurable: true, get() { return (this as HTMLElement).classList.contains("hc-html-host") ? 300 : 0; } });
    try {
      const arrow: ArrowElement = {
        id: "a",
        type: "arrow",
        points: [{ x: -300, y: 150 }, { x: 0, y: 150 }],
        routing: "auto",
        endBinding: { elementId: "b", fixedPoint: [0, 0.5], mode: "floating" },
      };
      const board: CanvasDoc = {
        title: "m",
        format: "board/v1",
        elements: [{ id: "b", type: "html", file: "b.html", x: 0, y: 0 }, arrow],
      };
      await render(board);
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      });

      const measuredDoc: CanvasDoc = {
        ...board,
        elements: [{ id: "b", type: "html", file: "b.html", x: 0, y: 0, measured: { w: 400, h: 300 } }, arrow],
      };
      const expected = resolveArrowGeometry(measuredDoc, arrow).bounds;
      const unmeasured = resolveArrowGeometry(board, arrow).bounds;
      expect(expected).not.toEqual(unmeasured);
      const el = host.querySelector<HTMLElement>('[data-hc-id="a"]')!;
      expect({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) }).toEqual(expected);
    } finally {
      for (const [k, d] of restore) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    }
  });
});

describe("框选全部包围盒", () => {
  it("上游 demo 画板的 collectBounds 全为有限数", () => {
    const rects = collectViewerBounds(loadDemo());
    expect(rects).toHaveLength(loadDemo().elements.length);
    for (const r of rects) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("未知元素按 x/y/w/h（缺尺寸取占位默认）计入", () => {
    const doc = {
      title: "u",
      format: "board/v1",
      elements: [
        { id: "a", type: "frame", name: "F", x: 0, y: 0, w: 10, h: 10 },
        { id: "b", type: "rich-note", x: 500, y: 600, w: 40, h: 30 },
        { id: "c", type: "sticker", x: 7, y: 8 },
      ],
    } as unknown as CanvasDoc;
    expect(collectViewerBounds(doc)).toEqual([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 500, y: 600, w: 40, h: 30 },
      { x: 7, y: 8, w: UNKNOWN_PLACEHOLDER_W, h: UNKNOWN_PLACEHOLDER_H },
    ]);
  });
});

describe("元素类型分派", () => {
  // 反方向（上游新增类型、查看器未接入）由类型检查兜：known-elements 的 satisfies Record<ElementType, true>
  // 与 ElementLayer 改写件的 never 分支在上游 schema 加类型后都会编译失败。
  it("查看器接入的每个类型都是上游 schema 认可的元素类型", () => {
    for (const type of Object.keys(RENDERED_TYPES)) {
      const r = validateCanvasDoc({ title: "t", format: "board/v1", elements: [{ id: "x", type }] });
      expect(r.errors.join("\n"), type).not.toContain("type 非法");
    }
  });

  it("schema 不认可的类型确实被判非法（上一条断言有效）", () => {
    const r = validateCanvasDoc({ title: "t", format: "board/v1", elements: [{ id: "x", type: "rich-note" }] });
    expect(r.errors.join("\n")).toContain("type 非法");
  });
});
