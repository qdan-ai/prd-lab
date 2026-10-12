/**
 * 画布字体就绪等待（查看器自有）
 *
 * 画布文本用 Geist / Geist Mono（gcanvas/ui/styles/base.css 的 @font-face），预览站上是远程加载。
 * 字体未到就挂载画布，文本会先按回退字体排版，TextView 首渲量出的 measured 也是回退字体的宽度，
 * 绑定到文本的箭头随之偏移。挂载画布前先显式加载这两个字体，最多等 FONT_WAIT_MS，到时照常挂载。
 */

/** 画布用到的字体（font 简写；字号只影响匹配，不影响下载） */
const CANVAS_FONTS = ['16px "Geist"', '16px "Geist Mono"'];

/** 最长等待：弱网下到时照常挂载，字体到达后由浏览器换入 */
export const FONT_WAIT_MS = 3000;

/** 字体全部加载完成（或失败）即 resolve；超过 timeoutMs 也 resolve；无 document.fonts 时立即 resolve */
export function waitForCanvasFonts(timeoutMs: number = FONT_WAIT_MS): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
  const loaded = Promise.all(CANVAS_FONTS.map((f) => fonts.load(f))).then(
    () => undefined,
    () => undefined,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([loaded, timeout]).finally(() => clearTimeout(timer));
}
