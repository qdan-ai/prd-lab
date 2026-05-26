"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileArchive, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { snapshotsApi, type ApiError } from "@/lib/api-client";
import { handleListContinuation } from "@/components/markdown";

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

type UploadState = "idle" | "selected" | "uploading" | "failed";

type DuplicateOfInfo = {
  snapshotId: string;
  seqNo: number;
  versionLabel: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
}

/**
 * 上传新版本 modal（S7 PM 主动权 + S8 平行化改造）
 *   idle | selected | uploading | failed
 *
 *  - 版本号 input（可选，PM 自定义如 "4.0.4"，留空 fallback v{seq}）
 *  - sha256 撞车 → 409 content_duplicate → 嵌套二次确认（仍要新建 / 切到现有 / 取消）
 *  - 区分 3 种成功 toast：新建 / 复活归档 / cli-mcp duplicateOfActive
 *  - S8：删除"上传后自动设为当前"checkbox —— snapshot 平行化无 current 概念
 */
export function UploadSnapshotModal({ open, onOpenChange, versionId }: Props) {
  const [state, setState] = useState<UploadState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [dupInfo, setDupInfo] = useState<DuplicateOfInfo | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const reset = useCallback(() => {
    setState("idle");
    setFile(null);
    setChangeNote("");
    setVersionLabel("");
    setErrorMsg("");
    setDupInfo(null);
    setIsDragOver(false);
    dragCounter.current = 0;
  }, []);

  const handleClose = (next: boolean) => {
    if (state === "uploading") {
      if (!window.confirm("正在上传，确认取消吗？")) return;
    }
    if (!next) reset();
    onOpenChange(next);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === "uploading") return;
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounter.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === "uploading") return;
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === "uploading") return;
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (state === "uploading") return;
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) onFileSelected(dropped);
  };

  const onFileSelected = (f: File | null) => {
    if (!f) {
      setFile(null);
      setState("idle");
      return;
    }
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setErrorMsg("只支持 .zip 文件");
      setState("failed");
      return;
    }
    if (f.size > MAX_ZIP_BYTES) {
      setErrorMsg(`文件超过 ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)}MB`);
      setState("failed");
      return;
    }
    setFile(f);
    setErrorMsg("");
    setState("selected");
  };

  /** 真正调用 upload；forceNew 用于 dup 二次确认后强制走新建 */
  const performUpload = async (forceNew: boolean) => {
    if (!file || !changeNote.trim()) return;
    setState("uploading");
    setErrorMsg("");
    try {
      const result = await snapshotsApi.upload(
        versionId,
        {
          file,
          changeNote: changeNote.trim(),
          versionLabel: versionLabel.trim() || undefined,
          forceNew,
        },
        { silent: true },
      );

      const label = result.snapshot.versionLabel
        ? `${result.snapshot.versionLabel}（v${result.snapshot.seqNo}）`
        : `v${result.snapshot.seqNo}`;

      if (result.matchedArchived) {
        toast.success(`已新建版本 ${label}`, {
          description: `检测到此内容曾在 v${result.matchedArchived.seqNo} 被删除，旧评论未自动恢复`,
        });
      } else {
        toast.success(`已新建版本 ${label}`);
      }

      onOpenChange(false);
      reset();
      setTimeout(() => router.refresh(), 220);
    } catch (e) {
      const apiErr = e as ApiError & {
        duplicateOf?: DuplicateOfInfo;
      };

      // 撞车 → 弹二次确认
      if (apiErr.error_code === "content_duplicate" && apiErr.duplicateOf) {
        setDupInfo(apiErr.duplicateOf);
        setState("selected");
        return;
      }

      // 其它错误：显示行内红框 + toast
      const labelMap: Record<string, string> = {
        version_label_conflict: "版本号已被占用",
        unauthorized: "请先登入",
        not_owner: "需要项目所有者权限",
        not_found: "项目或方案不存在",
        validation_error: "提交内容有误",
      };
      const friendly = labelMap[apiErr.error_code] ?? apiErr.message ?? "上传失败";
      setErrorMsg(friendly);
      setState("failed");
      toast.error(friendly, { description: apiErr.message });
    }
  };

  const onSubmit = () => {
    setDupInfo(null);
    void performUpload(false);
  };

  /** 撞车 → 仍要新建：重发带 forceNew=true */
  const onConfirmForceNew = () => {
    setDupInfo(null);
    void performUpload(true);
  };

  /** 撞车 → 切到现有版本：导航到 ?snapshot=v{seq}，不上传 */
  const onSwitchToExisting = () => {
    if (!dupInfo) return;
    const url = new URL(window.location.href);
    url.searchParams.set("snapshot", `v${dupInfo.seqNo}`);
    router.push(`${url.pathname}${url.search}`, { scroll: false });
    setDupInfo(null);
    onOpenChange(false);
    reset();
  };

  const submitDisabled =
    state === "uploading" || !file || !changeNote.trim() || (state === "failed" && !file);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="w-[540px] max-w-[calc(100vw-32px)] p-0 flex flex-col"
        data-testid="upload-modal"
      >
        {/* header */}
        <div className="px-6 pt-6 pb-5 border-b border-ink-150">
          <DialogTitle className="text-[16px]">上传新版本</DialogTitle>
          <DialogDescription className="text-[13px] text-ink-500 mt-1">
            选择画板 zip 文件，描述本次改动。
          </DialogDescription>
        </div>

        {/* body */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* dropzone / file row */}
          <div>
            <input
              ref={fileInputRef}
              id={inputId}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              disabled={state === "uploading"}
              onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
            />
            {!file ? (
              <label
                htmlFor={inputId}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-2.5 h-[148px] border rounded-[var(--radius-md)] cursor-pointer transition-colors ${
                  isDragOver
                    ? "border-solid border-ink-900 bg-ink-100"
                    : "border-dashed border-ink-300 hover:bg-ink-50 hover:border-ink-400"
                }`}
                data-testid="upload-dropzone"
                data-drag-over={isDragOver ? "true" : "false"}
              >
                <FileArchive
                  size={32}
                  strokeWidth={1.5}
                  className={isDragOver ? "text-ink-900" : "text-ink-400"}
                />
                <div className="text-[13px] text-ink-900 font-medium">
                  {isDragOver ? "松开以选择" : "点击或拖拽 zip 到这里"}
                </div>
                <div className="text-[11px] text-ink-500">最大 50MB · 仅支持 .zip</div>
              </label>
            ) : (
              <div
                className={`flex items-center justify-between gap-3 px-3.5 py-3 border rounded-[var(--radius-md)] ${
                  state === "failed"
                    ? "border-danger/40 bg-danger/5"
                    : state === "uploading"
                      ? "border-accent/40 bg-accent/5"
                      : "border-ink-200 bg-ink-50"
                }`}
                data-testid="upload-file-row"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {state === "uploading" ? (
                    <Loader2 size={18} className="animate-spin text-accent shrink-0" />
                  ) : (
                    <FileArchive size={18} className="text-ink-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate text-ink-900">{file.name}</div>
                    <div className="text-[11px] text-ink-500 tabular-nums mt-0.5">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                </div>
                {state !== "uploading" ? (
                  <button
                    type="button"
                    onClick={() => onFileSelected(null)}
                    className="text-ink-500 hover:text-ink-900 hover:bg-ink-100 p-1 rounded-[var(--radius-sm)] transition-colors"
                    aria-label="移除文件"
                    data-testid="remove-file"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {/* version_label（可选）*/}
          <div>
            <label
              htmlFor={`${inputId}-label`}
              className="flex items-center gap-1 text-[12px] font-medium text-ink-900 mb-1.5"
            >
              版本号
              <span className="text-[11px] text-ink-500 font-normal ml-1">（可选）</span>
            </label>
            <input
              id={`${inputId}-label`}
              type="text"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="例如：4.0.4"
              maxLength={64}
              disabled={state === "uploading"}
              className={`w-full px-3 py-2 text-[13px] leading-[1.55] border border-ink-200 rounded-[var(--radius-md)] placeholder:text-ink-400 focus:outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/15 transition-shadow ${
                state === "uploading" ? "opacity-50 pointer-events-none" : ""
              }`}
              data-testid="upload-version-label"
            />
            <div className="text-[11px] text-ink-500 mt-1">留空将自动用 v{`{seq}`}</div>
          </div>

          {/* change_note */}
          <div>
            <label
              htmlFor={`${inputId}-note`}
              className="flex items-center gap-1 text-[12px] font-medium text-ink-900 mb-1.5"
            >
              改动说明
              <span className="text-danger text-[13px] leading-none">*</span>
            </label>
            <textarea
              id={`${inputId}-note`}
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              onKeyDown={(e) => handleListContinuation(e, setChangeNote)}
              placeholder={'例如：\n- 新增弹窗交互\n- 修复首页 CTA 样式\n1. 调整流程顺序'}
              rows={5}
              maxLength={2000}
              disabled={state === "uploading"}
              className={`w-full px-3 py-2 text-[13px] leading-[1.55] border border-ink-200 rounded-[var(--radius-md)] resize-y placeholder:text-ink-400 focus:outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/15 transition-shadow font-mono ${
                state === "uploading" ? "opacity-50 pointer-events-none" : ""
              }`}
              data-testid="upload-change-note"
            />
            <div className="text-[11px] text-ink-500 mt-1">
              支持 Markdown：<code>-</code> 列表、<code>1.</code> 序号、<code>**粗体**</code>、<code>*斜体*</code>、<code>`代码`</code>
            </div>
          </div>

          {/* S8：删除"上传后自动设为当前"checkbox —— snapshot 平行化无 current 概念 */}

          {/* error */}
          {state === "failed" && errorMsg ? (
            <div
              className="px-3 py-2.5 text-[12px] text-danger border border-danger/30 bg-danger/5 rounded-[var(--radius-md)]"
              data-testid="upload-error"
            >
              {errorMsg}
            </div>
          ) : null}
        </div>

        {/* footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
          <Button variant="ghost" size="md" onClick={() => handleClose(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onSubmit}
            disabled={submitDisabled}
            data-testid="upload-submit"
            className="min-w-[88px]"
          >
            {state === "uploading" ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                上传中...
              </>
            ) : (
              <>
                <Upload size={13} strokeWidth={2.25} />
                上传
              </>
            )}
          </Button>
        </div>

        {/* 撞车二次确认（嵌套，仅 user 路径） */}
        {dupInfo ? (
          <DuplicateConfirmDialog
            dupInfo={dupInfo}
            onForceNew={onConfirmForceNew}
            onSwitch={onSwitchToExisting}
            onCancel={() => setDupInfo(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 撞车二次确认对话框（嵌套在上传 modal 内）
 * 主按钮"仍要新建" → force_new=true 重发；
 * 副按钮"切到现有" → 导航 ?snapshot=v{seq}；
 * 取消 → 关闭嵌套，回到上传 modal。
 */
function DuplicateConfirmDialog({
  dupInfo,
  onForceNew,
  onSwitch,
  onCancel,
}: {
  dupInfo: DuplicateOfInfo;
  onForceNew: () => void;
  onSwitch: () => void;
  onCancel: () => void;
}) {
  const label = dupInfo.versionLabel
    ? `${dupInfo.versionLabel}（v${dupInfo.seqNo}）`
    : `v${dupInfo.seqNo}`;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm rounded-[var(--radius-lg)]"
      data-testid="duplicate-confirm-overlay"
    >
      <div className="w-[calc(100%-48px)] bg-white border border-ink-200 rounded-[var(--radius-lg)] shadow-[var(--shadow-popup)] p-5">
        <div className="text-[14px] font-semibold text-ink-900 mb-1.5">内容已存在</div>
        <div className="text-[13px] text-ink-700 leading-relaxed">
          当前 zip 内容与 <span className="font-medium">{label}</span> 完全一致。
        </div>
        <div className="text-[12px] text-ink-500 mt-1.5 leading-relaxed">
          可以仍然新建一份留档（PM 主动权优先），或切到现有版本不上传。
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="md" onClick={onCancel} data-testid="dup-cancel">
            取消
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={onSwitch}
            data-testid="dup-switch"
          >
            切到 {label.split("（")[0] ?? ""} 不上传
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onForceNew}
            data-testid="dup-force-new"
          >
            仍要新建
          </Button>
        </div>
      </div>
    </div>
  );
}
