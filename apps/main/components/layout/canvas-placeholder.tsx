"use client";

import { useState } from "react";
import { Upload, Terminal, ArrowRight } from "lucide-react";
import { UploadSnapshotModal } from "@/components/upload-snapshot-modal";

/**
 * 中央画布占位：当 version 还没版本时显示。
 * 提供 "上传新版本" 触发器（与左抽屉底部同源 modal）。
 * 非 owner（仅 team 项目其他成员可达）→ 提示只读，按钮 disabled。
 */
export function CanvasPlaceholder({
  versionName,
  versionId,
  ownedByMe = true,
}: {
  versionName: string;
  versionId: string;
  ownedByMe?: boolean;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="flex-1 overflow-auto bg-[oklch(0.985_0_0)]">
      <div className="min-h-full flex items-center justify-center p-10">
        <div className="text-center max-w-[440px]">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-[var(--radius-lg)] bg-white border border-ink-200 shadow-[var(--shadow-sm)] mb-5">
            <Upload size={20} className="text-ink-500" strokeWidth={1.75} />
          </div>
          <h2 className="text-[17px] font-semibold text-ink-900 mb-2 tracking-tight">
            「{versionName}」方案还没有版本
          </h2>
          <p className="text-[13px] text-ink-500 leading-[1.65] mb-6">
            {ownedByMe
              ? "上传画板 zip 后，这里会显示完整的多 row 预览"
              : "项目所有者尚未上传版本（你不是所有者，无法上传）"}
          </p>

          <div className="flex items-center gap-3 justify-center mb-3">
            <button
              type="button"
              onClick={() => ownedByMe && setUploadOpen(true)}
              disabled={!ownedByMe}
              className={
                ownedByMe
                  ? "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-[var(--radius-md)] bg-ink-900 text-ink-50 text-[12px] font-medium hover:bg-ink-950 transition-colors"
                  : "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-[var(--radius-md)] bg-ink-200 text-ink-500 text-[12px] font-medium cursor-not-allowed"
              }
              data-testid="placeholder-upload-button"
              title={ownedByMe ? undefined : "仅项目所有者可上传版本"}
            >
              <Upload size={12} strokeWidth={2.25} />
              <span>上传新版本</span>
              {ownedByMe ? <ArrowRight size={11} strokeWidth={2.25} /> : null}
            </button>
            <span className="text-[12px] text-ink-400">或</span>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-white border border-ink-200 text-[12px] font-medium text-ink-700 opacity-50 cursor-not-allowed font-mono"
              title="S6 接入"
            >
              <Terminal size={12} strokeWidth={2.25} />
              <span>prd push</span>
            </button>
          </div>
        </div>
      </div>
      {ownedByMe ? (
        <UploadSnapshotModal
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          versionId={versionId}
        />
      ) : null}
    </div>
  );
}
