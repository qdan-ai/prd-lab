// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { validateCanvasDoc } from "./gcanvas/engine/schema";
import { collectViewerBounds } from "./known-elements";
import { migrateLegacyBoard } from "./legacy-board";
import type { BoardData, RendererConfig } from "./types";

/**
 * 旧格式兼容转换：旧版 x1/y1/x2/y2 箭头在加载时转成 points[]，旧快照不退化成占位卡。
 */

// docs 面板依赖 Excalidraw（node 下无法加载），与本用例无关，替换为空组件
vi.mock("./DocsPanel", () => ({ DocsPanel: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY_JSON = readFileSync(resolve(__dirname, "../fixtures/demo-board/canvas.json"), "utf-8");
const legacyBoard = (): BoardData => JSON.parse(LEGACY_JSON);

const board = (elements: unknown[]) => ({ title: "t", format: "board/v1", elements }) as unknown as BoardData;

describe("migrateLegacyBoard", () => {
  it("两端点箭头转成 points，删除旧字段，保留 label 与样式", () => {
    const out = migrateLegacyBoard(
      board([{ id: "a", type: "arrow", x1: 1, y1: 2, x2: 3, y2: 4, from: null, to: "b", label: "L", strokeColor: "#f00", parent: "f" }]),
    );
    expect(out.elements[0]).toEqual({
      id: "a",
      type: "arrow",
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      label: "L",
      strokeColor: "#f00",
      parent: "f",
    });
  });

  it("不猜测其它形态：已有 points、端点不全或非有限数、非箭头元素一律原样", () => {
    const input = board([
      { id: "p", type: "arrow", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], x1: 5, y1: 5, x2: 6, y2: 6 },
      { id: "q", type: "arrow", x1: 1, y1: 2, x2: 3 },
      { id: "r", type: "arrow", x1: 1, y1: 2, x2: 3, y2: Infinity },
      { id: "s", type: "shape", shape: "rect", x: 0, y: 0, w: 1, h: 1, x1: 1, y1: 1, x2: 2, y2: 2 },
    ]);
    const out = migrateLegacyBoard(input);
    expect(out).toBe(input);
  });

  it("旧 fixtures/demo-board 转换后通过 G-canvas 校验，包围盒全为有限数", () => {
    const raw = legacyBoard();
    expect(validateCanvasDoc(raw).ok).toBe(false);
    const out = migrateLegacyBoard(raw);
    expect(validateCanvasDoc(out).errors).toEqual([]);
    for (const r of collectViewerBounds(out)) expect(Number.isFinite(r.x + r.y + r.w + r.h)).toBe(true);
  });
});

describe("App 加载旧格式画板", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("canvas.json")) return new Response(LEGACY_JSON, { status: 200 });
        return new Response(url.endsWith(".css") ? "" : "<div>block</div>", { status: 200 });
      }),
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

  it("旧箭头按 points 渲染为箭头，不出现占位卡", async () => {
    const config: RendererConfig = {
      schemaVersion: 1,
      snapshotId: "legacy",
      dataBaseUrl: "/p/legacy/",
      entryHtmlPath: "index.html",
      rendererMetadata: { schemaVersion: 1, __computed: { docs: [], hasBlocks: true, hasStyles: true, elementCount: 12 } },
    };
    await act(async () => {
      root.render(<App config={config} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector(".hc-world")).not.toBeNull();
    expect(host.querySelector(".hc-unknown-el")).toBeNull();
    const arrow = host.querySelector<HTMLElement>('[data-hc-id="a1"]')!;
    expect(arrow.className).toBe("hc-arrow");
    expect(arrow.querySelector(".hc-arrow-label")?.textContent).toBe("进入判断");
    expect(host.querySelectorAll("[data-hc-id]")).toHaveLength(legacyBoard().elements.length);
  });
});
