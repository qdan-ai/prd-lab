import { GitBranch } from "lucide-react";

/** 仓库项目标记：项目内容由 G-canvas 仓库式推送维护。 */
export function RepoChip() {
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-sm)] border text-accent bg-accent-bg border-accent/20"
      title="G-canvas 仓库项目：内容由 G-canvas 推送维护"
      data-testid="repo-chip"
    >
      <GitBranch size={9} strokeWidth={2.25} />
      G-canvas 仓库
    </span>
  );
}
