// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { FONT_WAIT_MS, waitForCanvasFonts } from "./canvas-fonts";
import type { RendererConfig } from "./types";

/**
 * 画布挂载前等字体就绪：字体未到不挂载（显示加载状态），字体到达或超时后挂载；无 document.fonts 直接挂载。
 */

// docs 面板依赖 Excalidraw（node 下无法加载），与本用例无关，替换为空组件
vi.mock("./DocsPanel", () => ({ DocsPanel: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOARD = JSON.stringify({
  title: "fonts",
  format: "board/v1",
  elements: [{ id: "t1", type: "text", x: 0, y: 0, text: "登录 → 首页", fontSize: 22 }],
});

const CONFIG: RendererConfig = {
  schemaVersion: 1,
  snapshotId: "fonts",
  dataBaseUrl: "/p/fonts/",
  entryHtmlPath: "index.html",
  rendererMetadata: { schemaVersion: 1, __computed: { docs: [], hasBlocks: false, hasStyles: false, elementCount: 1 } },
};

/** 可控的 document.fonts：load() 返回的 promise 由测试决定何时完成 */
function stubFonts() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const load = vi.fn(() => gate.then(() => []));
  Object.defineProperty(document, "fonts", { configurable: true, value: { load } });
  return { load, release };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(BOARD, { status: 200 })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (document as { fonts?: unknown }).fonts;
});

async function mount() {
  await act(async () => {
    root.render(<App config={CONFIG} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const stage = () => host.querySelector(".hc-stage");

describe("画布等字体就绪后挂载", () => {
  it("字体未就绪：不挂载画布，显示加载状态；字体就绪后挂载", async () => {
    const fonts = stubFonts();
    await mount();
    expect(fonts.load).toHaveBeenCalledWith('16px "Geist"');
    expect(fonts.load).toHaveBeenCalledWith('16px "Geist Mono"');
    expect(stage()).toBeNull();
    expect(host.querySelector(".hc-canvas-status")?.textContent).toContain("加载画板");

    await act(async () => {
      fonts.release();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(stage()).not.toBeNull();
    expect(host.querySelector('[data-hc-id="t1"]')).not.toBeNull();
  });

  it("字体一直不到：超过等待上限后照常挂载", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubFonts();
    await act(async () => {
      root.render(<App config={CONFIG} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 100);
    });
    expect(stage()).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(stage()).not.toBeNull();
  });

  it("浏览器没有 document.fonts：直接挂载", async () => {
    await mount();
    expect(stage()).not.toBeNull();
  });

  it("字体加载失败按就绪处理，不卡住", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn(() => Promise.reject(new Error("network"))) },
    });
    await expect(waitForCanvasFonts(60_000)).resolves.toBeUndefined();
  });
});
