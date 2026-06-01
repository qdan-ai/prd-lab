import { RENDERERS } from "@prd-lab/core/renderers";

/**
 * GET /api/v1/renderers
 *
 * 返回 renderer 注册表给前端 UploadSnapshotModal 渲染 select。
 *
 * 设计要点（upload-renderer-selector sprint / D11）：
 *   - 不鉴权：信息无敏感性（renderer id 与描述），UI modal 渲染时调用
 *   - `default` 硬编码在响应头部，对应 rendererName=null（裸 HTML 路径）
 *   - 其余条目展开自 RENDERERS 注册表，prd-lab 主体保持不感知具体格式（R9）
 */
export async function GET() {
  const items = [
    {
      id: "default",
      displayName: "默认（直接渲染 HTML）",
      description: "不注入任何 SPA shell，按 zip 内 HTML 入口直接渲染",
    },
    ...Object.entries(RENDERERS).map(([id, spec]) => ({
      id,
      displayName: spec.name,
      description: spec.description,
    })),
  ];
  return Response.json(items);
}
