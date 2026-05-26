"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { snapshotsApi, type SnapshotRow } from "@/lib/api-client";
import { Markdown } from "@/components/markdown";

interface Props {
  open: boolean;
  target: SnapshotRow | null;
  versionId: string;
  onClose: () => void;
}

export function DeleteSnapshotModal({ open, target, versionId, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open) setDeleting(false);
  }, [open]);

  const onConfirm = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await snapshotsApi.archive(target.id, versionId);
      toast.success(`v${target.seqNo} 已删除`);
      onClose();
      setTimeout(() => router.refresh(), 220);
    } catch {
      // toast 已自动
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[480px] max-w-[calc(100vw-32px)] p-0 flex flex-col">
        <div className="px-6 pt-6 pb-5 border-b border-ink-150">
          <DialogTitle className="text-[16px]">
            删除快照{" "}
            <span className="text-ink-700 tabular-nums">v{target?.seqNo}</span>
          </DialogTitle>
          <div className="text-[13px] text-ink-500 mt-1">该操作可被项目所有者从归档恢复</div>
        </div>

        <div className="px-6 py-5">
          {target ? (
            <dl className="space-y-2.5 text-[13px]">
              <div className="flex gap-2">
                <dt className="text-ink-500 shrink-0 w-16">上传者</dt>
                <dd className="text-ink-900">{target.uploaderName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-500 shrink-0 w-16">改动说明</dt>
                <dd className="text-ink-900 min-w-0 flex-1">
                  <Markdown text={target.changeNote} className="space-y-1.5 leading-[1.55]" />
                </dd>
              </div>
            </dl>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
          <Button variant="ghost" size="md" onClick={onClose} disabled={deleting}>
            取消
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={onConfirm}
            disabled={deleting}
            data-testid="delete-confirm"
            className="min-w-[88px]"
          >
            {deleting ? "删除中..." : "确认删除"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
