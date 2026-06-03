"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useModalStack } from "@/components/modal-stack";
import { projectsApi, versionsApi } from "@/lib/api-client";
import { useCreateDialogStore } from "./use-create-dialog-store";

/**
 * S17：通用「新建」聚焦弹窗。
 *   - mode==="project"：项目名 + 可见性（默认团队）→ 建项目 → 跳 /projects/{pid}（落地页空状态）
 *   - mode==="version"：方案名 → 建方案 → 跳 /projects/{pid}/versions/{vid}
 * 全局挂一份即可（订阅 useCreateDialogStore）。
 */
export function CreateDialog() {
  const mode = useCreateDialogStore((s) => s.mode);
  const projectId = useCreateDialogStore((s) => s.projectId);
  const projectName = useCreateDialogStore((s) => s.projectName);
  const close = useCreateDialogStore((s) => s.close);

  const router = useRouter();
  const open = mode !== "none";

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "team">("team");
  const [pending, setPending] = useState(false);

  // 每次打开重置字段
  useEffect(() => {
    if (open) {
      setName("");
      setVisibility("team");
      setPending(false);
    }
  }, [open, mode]);

  useModalStack(open, () => {
    close();
    return true;
  });

  const trimmed = name.trim();
  const canSubmit = !pending && trimmed.length > 0;

  async function submit() {
    if (!canSubmit) return;
    setPending(true);
    try {
      if (mode === "project") {
        const { project } = await projectsApi.create({ name: trimmed, visibility });
        const url = `/projects/${project.id}`;
        router.prefetch(url);
        toast.success("项目已创建");
        close();
        router.push(url);
      } else if (mode === "version" && projectId) {
        const version = await versionsApi.create(projectId, { name: trimmed });
        const url = `/projects/${projectId}/versions/${version.id}`;
        router.prefetch(url);
        toast.success(`方案「${trimmed}」已建`);
        close();
        router.push(url);
      }
    } catch {
      // toast 已在 apiFetch 里弹；保持窗口让用户修正
    } finally {
      setPending(false);
    }
  }

  const isProject = mode === "project";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="w-[480px] max-w-[calc(100vw-32px)] p-0 flex flex-col"
        onEscapeKeyDown={(e) => e.preventDefault() /* 交给 ModalStackProvider */}
      >
        <div className="px-6 pt-6 pb-5 border-b border-ink-150">
          <DialogTitle className="text-[16px]">
            {isProject ? "新建项目" : `在「${projectName ?? ""}」下新建方案`}
          </DialogTitle>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="px-6 py-5 space-y-4"
        >
          <label className="block text-sm">
            <div className="text-[12px] text-ink-700 font-medium mb-1.5">
              {isProject ? "项目名称" : "方案名称"}
            </div>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isProject ? "如：AI 投顾" : "如：AI 选好股 4.0"}
              maxLength={isProject ? 128 : 64}
              required
              data-testid="create-dialog-input"
            />
          </label>

          {isProject ? (
            <fieldset>
              <legend className="text-[12px] text-ink-700 font-medium mb-1.5">可见性</legend>
              <div className="flex gap-4 text-sm">
                {[
                  { v: "private", label: "私有（仅我）" },
                  { v: "team", label: "团队（所有人可见）" },
                ].map((opt) => (
                  <label key={opt.v} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      value={opt.v}
                      checked={visibility === (opt.v as "private" | "team")}
                      onChange={() => setVisibility(opt.v as "private" | "team")}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </form>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
          <Button variant="ghost" size="md" onClick={close} disabled={pending}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="create-dialog-submit"
            className="min-w-[88px]"
          >
            {pending ? "创建中..." : "创建"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
