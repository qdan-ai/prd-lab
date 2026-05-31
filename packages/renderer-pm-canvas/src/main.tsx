import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/**
 * SPA 启动入口（DESIGN §7.3.2）：
 *
 * 1. 读 window.__PRD_LAB_RENDERER_CONFIG__（由预览站 shell HTML inline <script> 注入）
 * 2. 校验 schemaVersion；不匹配 → 显示错误，拒绝挂载
 * 3. 渲染 <App config={...} />
 *
 * 错误处理：任何启动阶段失败一律渲染纯文本错误页，不让 SPA 静默挂掉。
 */

const SUPPORTED_SCHEMA_VERSION = 1;

function mount() {
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    document.body.innerHTML = `<div class="pm-canvas-fatal">renderer error: #root not found</div>`;
    return;
  }

  const config = window.__PRD_LAB_RENDERER_CONFIG__;
  if (!config) {
    rootEl.innerHTML = `<div class="pm-canvas-fatal">renderer error: window.__PRD_LAB_RENDERER_CONFIG__ missing</div>`;
    return;
  }

  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    rootEl.innerHTML = `<div class="pm-canvas-fatal">renderer schema mismatch: expect ${SUPPORTED_SCHEMA_VERSION}, got ${String(config.schemaVersion)}<br/>请联系管理员升级 renderer 包</div>`;
    return;
  }

  try {
    createRoot(rootEl).render(
      <StrictMode>
        <App config={config} />
      </StrictMode>,
    );
  } catch (e) {
    const err = e as Error;
    console.error("[pm-canvas] mount failed:", err.message, "\nstack:", err.stack);
    rootEl.innerHTML = `<pre style="padding:20px;color:#c00;white-space:pre-wrap;font-family:monospace;font-size:12px">mount failed: ${err.message}\n\n${err.stack ?? ""}</pre>`;
  }
}

// 顶层 unhandledrejection / error 捕获，避开 React 内部 hook 链路
window.addEventListener("error", (event) => {
  console.error("[pm-canvas window.error]", event.message, event.filename, event.lineno, event.colno, event.error?.stack);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[pm-canvas unhandledrejection]", event.reason, (event.reason as Error)?.stack);
});

mount();
