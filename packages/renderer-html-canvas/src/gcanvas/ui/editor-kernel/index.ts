/**
 * 编辑内核入口垫片（PRD-Lab 自有）—— 顶替 G-canvas 的 ui/editor-kernel/index.ts
 *
 * 查看器只读：TextView 只用静态渲染（Markdown → 安全 HTML），不挂编辑器、工具栏与 controller。
 * 静态渲染链（static-render / extensions / markdown / literal-fallback）为逐字复制件。
 */
export { renderStaticMarkdown } from './static-render'
