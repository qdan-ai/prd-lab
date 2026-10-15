/**
 * G-canvas 仓库式推送：接收端（推送）与数据读取端（查看器）。
 * 以子路径 `@prd-lab/core/repo` 导出：依赖渲染器注册表（校验 canvas.json），与 `@prd-lab/core/renderers` 同理不进根导出。
 * 设计见 ai/specs/2026-10-15-repo-push-design.md。
 */
export * from "./manifest";
export * from "./digest";
export * from "./resolve";
export * from "./project";
export * from "./sync";
export * from "./read";
