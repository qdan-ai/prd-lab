"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { versionsApi } from "@/lib/api-client";

interface Props {
  open: boolean;
  target: { id: string; name: string } | null;
  projectId: string;
  onClose: () => void;
  /** 删完跳转目标（删的是当前正在看的方案时传 `/projects/{pid}`）；不传则 router.refresh */
  redirectTo?: string;
  /** 删完额外回调（如 switcher mutate） */
  onDeleted?: () => void;
}

/** S17：删除方案确认弹窗（软删，可由所有者从归档恢复）。 */
export function DeleteVersionModal({
  open,
  target,
  projectId,
  onClose,
  redirectTo,
  onDeleted,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open) setDeleting(false);
  }, [open]);

  const onConfirm = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await versionsApi.archive(target.id, projectId);
      toast.success(`方案「${target.name}」已删除`);
      onClose();
      onDeleted?.();
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        setTimeout(() => router.refresh(), 220);
      }
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
            删除方案 <span className="text-ink-700">「{target?.name}」</span>
          </DialogTitle>
          <div className="text-[13px] text-ink-500 mt-1">
            该方案下的所有版本将一并归档，可由项目所有者从归档恢复
          </div>
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
            data-testid="delete-version-confirm"
            className="min-w-[88px]"
          >
            {deleting ? "删除中..." : "确认删除"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
