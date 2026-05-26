"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { snapshotsApi, type SnapshotRow } from "@/lib/api-client";
import { handleListContinuation } from "@/components/markdown";

interface Props {
  open: boolean;
  target: SnapshotRow | null;
  versionId: string;
  onClose: () => void;
}

export function RenameChangeNoteModal({ open, target, versionId, onClose }: Props) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (target) setValue(target.changeNote);
  }, [target]);

  const onSave = async () => {
    if (!target || !value.trim()) return;
    setSaving(true);
    try {
      await snapshotsApi.rename(target.id, versionId, { change_note: value.trim() });
      toast.success("已保存");
      onClose();
      setTimeout(() => router.refresh(), 220);
    } catch {
      // toast 已自动
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[480px] max-w-[calc(100vw-32px)] p-0 flex flex-col">
        <div className="px-6 pt-6 pb-5 border-b border-ink-150">
          <DialogTitle className="text-[16px]">重命名改动说明</DialogTitle>
          {target ? (
            <div className="text-[13px] text-ink-500 mt-1">
              快照 <span className="tabular-nums font-medium text-ink-700">v{target.seqNo}</span>
            </div>
          ) : null}
        </div>

        <div className="px-6 py-5">
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSave();
                return;
              }
              handleListContinuation(e, setValue);
            }}
            rows={6}
            maxLength={2000}
            placeholder={"例如：\n- 调整流程顺序\n- 微调字号"}
            className="w-full px-3 py-2 text-[13px] leading-[1.55] border border-ink-200 rounded-[var(--radius-md)] resize-y placeholder:text-ink-400 focus:outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/15 transition-shadow font-mono"
            data-testid="rename-textarea"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
            <span>
              支持 Markdown：<code>-</code> <code>1.</code> <code>**粗**</code> <code>*斜*</code> <code>`代码`</code>
            </span>
            <span>
              按 <kbd className="px-1 py-0.5 bg-ink-100 rounded-[var(--radius-sm)] text-[10px]">⌘ Enter</kbd> 提交
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
          <Button variant="ghost" size="md" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onSave}
            disabled={!value.trim() || saving}
            data-testid="rename-save"
            className="min-w-[88px]"
          >
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
