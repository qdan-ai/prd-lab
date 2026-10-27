"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useModalStack } from "@/components/modal-stack";
import { projectsApi } from "@/lib/api-client";

export interface VisibilityTarget {
  id: string;
  name: string;
  visibility: "private" | "team";
  ownedByMe: boolean;
}

/** All entry points share the same confirmation and visibility-only PATCH. */
export function ProjectVisibilityDialog({ target, onClose, onChanged }: {
  target: VisibilityTarget | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const makePrivate = target?.visibility === "team";
  const close = () => {
    if (inFlight.current) return;
    setError(false);
    onClose();
  };
  useModalStack(target !== null, () => { close(); return true; });

  async function confirm() {
    if (!target || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(false);
    try {
      await projectsApi.rename(target.id, { visibility: makePrivate ? "private" : "team" });
      toast.success(makePrivate ? "已改为私有" : "已改为团队可见");
      onClose();
      onChanged?.();
      // Non-owners always return to the workbench, including legitimate members.
      // This avoids guessing membership from the site-admin capability.
      if (!target.ownedByMe) router.replace("/projects");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        showClose={false}
        className="w-[480px] max-w-[calc(100vw-32px)] p-0"
        data-testid="project-visibility-dialog"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}
      >
        <div className="px-6 pt-6 pb-5 border-b border-ink-150">
          <DialogTitle>{makePrivate ? "改为私有" : "改为团队可见"} · {target?.name}</DialogTitle>
          <DialogDescription>
            {makePrivate
              ? "改为私有后，站内只有创建者和协作成员能看到这个项目。已发出的访客链接不受影响，拿到链接的人仍可查看；如需停止外部访问，请撤销访客链接。"
              : "改为团队可见后，所有登录用户都能在站内查看这个项目。已发出的访客链接不受影响。"}
          </DialogDescription>
          {target && !target.ownedByMe ? <p className="text-xs text-ink-500 mt-3">操作后返回工作台；若你是有效协作成员，可从工作台重新进入。</p> : null}
          {error ? <p role="alert" className="text-sm text-red-600 mt-3">未能更改可见性，请重试或取消。</p> : null}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
          <Button ref={cancelRef} variant="ghost" size="md" onClick={close} disabled={pending}>取消</Button>
          <Button variant="primary" size="md" onClick={confirm} disabled={pending} data-testid="project-visibility-confirm">
            {pending ? "保存中..." : makePrivate ? "确认改为私有" : "确认团队可见"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
