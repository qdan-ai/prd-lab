"use client";

import { useEffect, useRef, useState } from "react";

const PREVIEW_ORIGIN = process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? "http://preview.local";
const REFRESH_INTERVAL_MS = 4 * 60 * 1000;

interface Props {
  shareId: string;
  snapshotId: string;
  initialToken: string;
  allowComment: boolean;
  visitor: { name: string; email: string };
}

type Stage = "init" | "entry" | "manifest" | "row" | "annotations" | "done" | "error";
const STAGE_LABELS: Record<Stage, string> = {
  init: "正在加载画板",
  entry: "正在加载入口",
  manifest: "正在解析画板清单",
  row: "正在加载模块",
  annotations: "正在初始化标注",
  done: "加载完成",
  error: "加载失败",
};

function previewHostname(): string {
  try {
    return new URL(PREVIEW_ORIGIN).hostname;
  } catch {
    return "preview.local";
  }
}

/**
 * 访客侧 iframe wrapper（与 owner 侧 CanvasFrame 同型但更精简）。
 *   - 不处理标注编辑 / resolve / delete（访客无权）
 *   - 评论 create/list 走 /share/[shareId]/api/comments
 *   - token 续签走 /share/[shareId]/api/preview-token
 *   - SDK 始终 readonly = !allowComment（防访客在不允许留评的 share 上 click 创建）
 */
export function ShareCanvasFrame({
  shareId,
  snapshotId,
  initialToken,
  allowComment,
  visitor,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = useState<Stage>("init");
  const [percent, setPercent] = useState(0);
  const [hidden, setHidden] = useState(false);
  const allowCommentRef = useRef(allowComment);
  allowCommentRef.current = allowComment;

  // 周期续签：4min 推 share 域 preview-token
  useEffect(() => {
    const refresh = async () => {
      try {
        const res = await fetch(`/share/${shareId}/api/preview-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshotId }),
        });
        if (!res.ok) return;
        const { token } = (await res.json()) as { token: string; expiresIn: number };
        iframeRef.current?.contentWindow?.postMessage(
          { type: "prd-token-refresh", token },
          PREVIEW_ORIGIN,
        );
      } catch {
        /* 静默；下次重试 */
      }
    };
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [shareId, snapshotId]);

  // postMessage 桥
  useEffect(() => {
    const previewHost = previewHostname();
    const onMessage = (e: MessageEvent) => {
      try {
        if (!e.origin || new URL(e.origin).hostname !== previewHost) return;
      } catch {
        return;
      }
      const data = e.data;
      if (!data || typeof data !== "object" || typeof (data as { type?: unknown }).type !== "string")
        return;
      const type = (data as { type: string }).type;

      if (type === "prd-canvas-progress") {
        const p = data as { percent?: number; stage?: Stage };
        if (typeof p.percent === "number") setPercent(p.percent);
        if (p.stage) setStage(p.stage);
        if (p.stage === "done") setTimeout(() => setHidden(true), 300);
        return;
      }

      // --- canvas-runtime SDK 加载完成 → 拉 DB annotations 推 init（访客版强制 readonly=true） ---
      if (type === "prd-runtime:script-loaded") {
        fetch(`/share/${shareId}/api/annotations?snapshotId=${encodeURIComponent(snapshotId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((res) => {
            if (!res) return;
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "prd-runtime:init",
                snapshotId,
                annotations: res.annotations,
                revision: res.revision,
                editMode: false, // 访客无标注编辑权
                readonly: true,
              },
              PREVIEW_ORIGIN,
            );
          })
          .catch(() => {});
        return;
      }

      // --- 访客 popover 内 ✓ 按钮（vendor 不分访客/owner 都渲染）→ 推 SDK 提示无权 ---
      if (type === "prd-comment:request-resolve" || type === "prd-comment:request-delete") {
        const reqId = (data as { commentId?: string }).commentId ?? "noop";
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "prd-comment:operation-result",
            reqId,
            ok: false,
            error: "not_owner",
          },
          PREVIEW_ORIGIN,
        );
        return;
      }

      if (type === "prd-comment:script-loaded") {
        // 拉评论列表 + 推 init
        fetch(`/share/${shareId}/api/comments?snapshotId=${encodeURIComponent(snapshotId)}`, {
          method: "GET",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((res) => {
            if (!res) return;
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "prd-comment:init",
                snapshotId,
                comments: res.comments,
                commentMode: false,
                readonly: !allowCommentRef.current,
                currentUserId: null,
                currentUserName: visitor.name,
              },
              PREVIEW_ORIGIN,
            );
          })
          .catch(() => {});
        return;
      }

      if (type === "prd-comment:create") {
        const req = data as { reqId: string; [k: string]: unknown };
        const { reqId, ...payload } = req;
        fetch(`/share/${shareId}/api/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(async (r) => {
            if (!r.ok) {
              const body = await r.json().catch(() => ({ error_code: "unknown" }));
              iframeRef.current?.contentWindow?.postMessage(
                {
                  type: "prd-comment:operation-result",
                  reqId,
                  ok: false,
                  error: body.error_code || "unknown",
                },
                PREVIEW_ORIGIN,
              );
              return;
            }
            const body = (await r.json()) as { comment: unknown };
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "prd-comment:operation-result",
                reqId,
                ok: true,
                comment: body.comment,
              },
              PREVIEW_ORIGIN,
            );
            // 重拉列表 → 同步 vendor popover 楼层 / pin 数字
            const listRes = await fetch(
              `/share/${shareId}/api/comments?snapshotId=${encodeURIComponent(snapshotId)}`,
            );
            if (listRes.ok) {
              const listBody = (await listRes.json()) as { comments: unknown[] };
              iframeRef.current?.contentWindow?.postMessage(
                {
                  type: "prd-comment:list:update",
                  snapshotId,
                  comments: listBody.comments,
                },
                PREVIEW_ORIGIN,
              );
            }
          })
          .catch(() => {
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "prd-comment:operation-result",
                reqId,
                ok: false,
                error: "network_error",
              },
              PREVIEW_ORIGIN,
            );
          });
        return;
      }

      // 访客不处理 prd-annotation:put / prd-comment:request-resolve / prd-comment:request-delete
      // SDK 收到 init readonly=true 后这些按钮也不会渲染
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [shareId, snapshotId, visitor.name]);

  const initialSrc = `${PREVIEW_ORIGIN}/p/${snapshotId}/?token=${encodeURIComponent(initialToken)}`;

  return (
    <div className="relative flex-1 overflow-hidden bg-ink-50">
      <iframe
        ref={iframeRef}
        src={initialSrc}
        className="absolute inset-0 w-full h-full border-0 bg-white"
        title="画板预览"
        data-testid="share-canvas-iframe"
      />
      {!hidden ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-white/85 pointer-events-none"
          data-testid="share-canvas-loading"
          aria-hidden={hidden}
        >
          <div className="w-[280px] max-w-[80%]">
            <div className="text-[12px] text-ink-700 mb-2 text-center">{STAGE_LABELS[stage]}</div>
            <div className="h-1 bg-ink-100 rounded-[var(--radius-sm)] overflow-hidden">
              <div
                className="h-full bg-ink-900 transition-[width] duration-200"
                style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
