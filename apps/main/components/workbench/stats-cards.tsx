import { FolderOpen, Upload } from "lucide-react";
import { formatRelative } from "./format";

interface LatestUpload {
  createdAt: Date;
  projectName: string;
}

interface Props {
  totalProjects: number;
  latestUpload: LatestUpload | null;
}

export function WorkbenchStatsCards({ totalProjects, latestUpload }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card icon={<FolderOpen size={14} strokeWidth={2} className="text-ink-400" />} label="项目总数">
        <span className="text-[22px] font-semibold tracking-tight text-ink-900 tabular-nums">
          {totalProjects}
        </span>
      </Card>
      <Card icon={<Upload size={14} strokeWidth={2} className="text-ink-400" />} label="最近上传">
        {latestUpload ? (
          <div className="flex items-baseline gap-2">
            <span className="text-[22px] font-semibold tracking-tight text-ink-900">
              {formatRelative(latestUpload.createdAt)}
            </span>
            <span className="text-[13px] text-ink-500 truncate">
              · {latestUpload.projectName}
            </span>
          </div>
        ) : (
          <span className="text-[22px] font-semibold tracking-tight text-ink-300">—</span>
        )}
      </Card>
    </div>
  );
}

interface CardProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

function Card({ icon, label, children }: CardProps) {
  return (
    <div className="bg-white border border-ink-200 rounded-[var(--radius-md)] px-5 py-4">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
